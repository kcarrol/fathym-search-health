/**
 * The workbench's five tools. MCP names come out as `site-check`, `keywords-pull`, `searchconsole-pull`,
 * `opportunities-scan` and `report-current` / `report-history` / `report-export`; API mode serves the same
 * methods as `POST /{tool}/{method}`. Inputs are validated here, because fAI passes API and in-process
 * calls through as given. Every run is kept as a snapshot in the vault.
 */
import { z } from "zod";
import { Tool } from "@fathym/fai/tools";
import { dataDir, devSpaceDir, env, githubToken, SITE } from "./config.ts";
import { type Kind, readHistory, SnapshotVault } from "./vault/SnapshotVault.ts";
import { checkSite, type SiteReport } from "./site/check.ts";
import { httpFetcher } from "./site/sitemap.ts";
import { DataForSeo } from "./keywords/dataforseo.ts";
import { estimateCost, pullKeywords } from "./keywords/pull.ts";
import { readWatchlist } from "./watchlist.ts";
import { fileTokenSource } from "./gsc/auth.ts";
import { httpGscFetch, pullSearchConsole } from "./gsc/pull.ts";
import { httpGitHub, scanOpportunities } from "./opportunities/scan.ts";
import { current, exportToDevSpace, history } from "./report/report.ts";

/** What the tools reach the outside world through; tests swap these. */
export interface Deps {
  DataDir?: () => string;
  Site?: string;
  Fetch?: ReturnType<typeof httpFetcher>;
  DataForSeo?: DataForSeo;
  Gsc?: Parameters<typeof pullSearchConsole>[0];
  GitHub?: Parameters<typeof scanOpportunities>[0];
  Watchlist?: () => ReturnType<typeof readWatchlist>;
}

interface VaultLike {
  Journal: (name?: string) => Promise<{ Capture: (e: unknown) => Promise<unknown>; Seal: () => Promise<unknown> }>;
  Curate: () => Promise<{ Propose: (o: { Name: string; Message: string }) => Promise<unknown>; Accept: (p: string) => Promise<void> }>;
  Close: () => Promise<void>;
}
type Ctx = { Vaults: { Snapshots: (input: { Path: string }) => Promise<VaultLike> } };

/**
 * Keeps one run as a snapshot. At fAI 0.0.1009 a journal's Seal() only integrates into pending; promoting
 * pending to kept (which writes the snapshot file) happens on its own only in the vault's timed auto-seal.
 * So the capture is proposed and accepted here, and Close() waits for the file to be written.
 */
async function keep(ctx: unknown, path: string, kind: Kind, results: unknown): Promise<void> {
  const vault = await (ctx as Ctx).Vaults.Snapshots({ Path: path });
  const journal = await vault.Journal(kind);
  await journal.Capture({ Timestamp: Date.now(), Kind: kind, Results: results as Record<string, unknown> });
  await journal.Seal();
  const curator = await vault.Curate();
  const name = `${kind}-${Date.now()}`;
  await curator.Propose({ Name: name, Message: `search-health ${kind} run` });
  await curator.Accept(name);
  await vault.Close();
}

const fn = <I extends z.ZodType>(input: I, describe: string) =>
  z.function({ input: [input], output: z.promise(z.unknown()) }).describe(describe);

export function tools(d: Deps = {}) {
  const data = d.DataDir ?? dataDir;
  const site = d.Site ?? SITE;
  const watchlist = d.Watchlist ?? (() => readWatchlist());

  const SiteArgs = z.object({ MaxLinks: z.number().int().min(0).max(5000).optional().describe("Most internal links outside the sitemap to check (default 500).") });
  const Site = Tool("Site", "fathym.com's health for search engines and AI crawlers")
    .Vaults({ Snapshots: SnapshotVault() })
    .Handle(z.object({
      Check: fn(SiteArgs, "Check the live site now: robots.txt, the sitemap, every sitemap page (status, canonical, noindex, title, H1s), URLs that should not exist (soft-200s) and internal links. Returns the issues with what changed since the last check, and keeps the result."),
    }))
    .Execute((ctx) => Promise.resolve({
      Check: async (args: unknown) => {
        const { MaxLinks } = SiteArgs.parse(args ?? {});
        const report = await checkSite(site, d.Fetch ?? httpFetcher(), { MaxLinks });
        await keep(ctx, data(), "site", report);
        const { site: summary } = await current(data()) as { site: unknown };
        return summary;
      },
    }));

  const PullArgs = z.object({ DryRun: z.boolean().optional().describe("Only report the estimated cost and the watch list; call nothing paid.") });
  const Keywords = Tool("Keywords", "What fathym.com ranks for and what to write next, from DataForSEO (paid)")
    .Vaults({ Snapshots: SnapshotVault() })
    .Handle(z.object({
      Pull: fn(PullArgs, "Pull keyword data from DataForSEO for the watch list: what fathym.com ranks for, ideas around each seed with search volume, and the Google results page (with AI Overview) for the top candidates. PAID, about $0.42 a run; it stops before calling anything if the estimate is above the watch list's MaxEstimatedCost. Use DryRun to see the estimate."),
    }))
    .Execute((ctx) => Promise.resolve({
      Pull: async (args: unknown) => {
        const { DryRun } = PullArgs.parse(args ?? {});
        const w = await watchlist();
        if (DryRun) return { EstimatedCost: Number(estimateCost(w).toFixed(4)), Seeds: w.Seeds, MaxEstimatedCost: w.MaxEstimatedCost };
        const result = await pullKeywords(w, d.DataForSeo ?? new DataForSeo());
        await keep(ctx, data(), "keywords", result);
        const { keywords } = await current(data()) as { keywords: unknown };
        return keywords;
      },
    }));

  const GscArgs = z.object({
    Days: z.number().int().min(1).max(480).optional().describe("Days of search data, ending 3 days ago (default 28)."),
    InspectBatch: z.number().int().min(0).max(2000).optional().describe("Sitemap URLs to inspect this run (default 100; the per-site quota is 2,000 a day)."),
  });
  const SearchConsole = Tool("SearchConsole", "fathym.com as Google sees it, from Search Console (read-only)")
    .Vaults({ Snapshots: SnapshotVault() })
    .Handle(z.object({
      Pull: fn(GscArgs, "Read Search Console: queries and pages with clicks, impressions, CTR and position; whether Google indexed a rotating batch of sitemap URLs and which canonical it chose; and the sitemaps Google read. Keeps the result."),
    }))
    .Execute((ctx) => Promise.resolve({
      Pull: async (args: unknown) => {
        const { Days, InspectBatch } = GscArgs.parse(args ?? {});
        const [lastSite] = await readHistory(data(), "site", 1);
        const [lastGsc] = await readHistory(data(), "searchconsole", 1);
        const result = await pullSearchConsole(d.Gsc ?? httpGscFetch(fileTokenSource()), {
          Property: env("GSC_PROPERTY") ?? "sc-domain:fathym.com",
          Days, InspectBatch,
          InspectUrls: (lastSite?.Results as unknown as SiteReport | undefined)?.SitemapUrls ?? [],
          InspectFrom: (lastGsc?.Results as { NextInspectFrom?: number } | undefined)?.NextInspectFrom ?? 0,
        });
        await keep(ctx, data(), "searchconsole", result);
        const { searchconsole } = await current(data()) as { searchconsole: unknown };
        return searchconsole;
      },
    }));

  const ScanArgs = z.object({ Since: z.iso.datetime({ offset: true }).optional().describe("Scan issues updated since this time. Default: the last scan, or 14 days ago.") });
  const Opportunities = Tool("Opportunities", "Changes in our own work that might change what we watch")
    .Vaults({ Snapshots: SnapshotVault() })
    .Handle(z.object({
      Scan: fn(ScanArgs, "Gather the issues updated since the last scan in fathym-dev-space, fathym-web-runtime and fathym-research, each with the watch-list terms it mentions, and the watch list beside them. Judges nothing: read it with the opportunity-review prompt and propose watch-list changes for a person to make."),
    }))
    .Execute((ctx) => Promise.resolve({
      Scan: async (args: unknown) => {
        const { Since } = ScanArgs.parse(args ?? {});
        const w = await watchlist();
        const [last] = await readHistory(data(), "opportunities", 1);
        const since = Since ?? (last ? new Date(last.Timestamp).toISOString() : new Date(Date.now() - 14 * 86_400_000).toISOString());
        const result = await scanOpportunities(d.GitHub ?? httpGitHub(githubToken), [...w.Seeds, ...w.Terms], since);
        await keep(ctx, data(), "opportunities", result);
        return { ...result, Watchlist: { Seeds: w.Seeds, Terms: w.Terms, Pages: w.Pages } };
      },
    }));

  const HistoryArgs = z.object({ Kind: z.enum(["site", "keywords", "searchconsole", "opportunities"]), Limit: z.number().int().min(1).max(100).optional() });
  const Report = Tool("Report", "The current answer, its history, and an export into dev-space")
    .Handle(z.object({
      Current: fn(z.object({}), "Is the site healthy, and what should we write next? The latest result of each kind, with what changed since the run before and when each last ran. Calls nothing outside."),
      History: fn(HistoryArgs, "Past runs of one kind, newest first."),
      Export: fn(z.object({}), "Write the latest results into the dev-space checkout (research/fathym-marketing/demand and site-health), for a person to review and commit. Local runs only."),
    }))
    .Execute(() => Promise.resolve({
      Current: () => current(data()),
      History: (args: unknown) => {
        const { Kind, Limit } = HistoryArgs.parse(args ?? {});
        return history(data(), Kind, Limit);
      },
      Export: () => exportToDevSpace(data(), devSpaceDir()),
    }));

  return { Site, Keywords, SearchConsole, Opportunities, Report };
}
