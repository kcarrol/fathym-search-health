/**
 * Report: the latest answer of each kind, and what changed since the run before it. Reads the vault's
 * snapshot files; never calls anything outside.
 */
import { join } from "@std/path";
import { type Kind, KINDS, readHistory, type Snapshot, stamp } from "../vault/SnapshotVault.ts";
import type { Issue, SiteReport } from "../site/check.ts";
import type { KeywordsResult } from "../keywords/pull.ts";
import type { GscResult } from "../gsc/pull.ts";
import type { OpportunitiesResult } from "../opportunities/scan.ts";
import { searchConsoleReports } from "../gsc/reports.ts";
import { readWatchlist, type Watchlist, WatchlistSchema } from "../watchlist.ts";

const key = (i: Issue) => `${i.Kind} ${i.Url}`;

export function diffSite(cur: SiteReport, prev?: SiteReport) {
  const before = new Set((prev?.Issues ?? []).map(key));
  const now = new Set(cur.Issues.map(key));
  const prevUrls = new Set(prev?.SitemapUrls ?? []);
  const curUrls = new Set(cur.SitemapUrls);
  return {
    New: prev ? cur.Issues.filter((i) => !before.has(key(i))) : [],
    Fixed: prev ? prev.Issues.filter((i) => !now.has(key(i))) : [],
    Unchanged: prev ? cur.Issues.filter((i) => before.has(key(i))).length : 0,
    SitemapAdded: prev ? cur.SitemapUrls.filter((u) => !prevUrls.has(u)) : [],
    SitemapRemoved: prev ? prev.SitemapUrls.filter((u) => !curUrls.has(u)) : [],
  };
}

export function diffKeywords(cur: KeywordsResult, prev?: KeywordsResult) {
  if (!prev) return { NewCandidates: [], DroppedCandidates: [], RankMoves: [] };
  const prevC = new Set(prev.Candidates.map((c) => c.Keyword.toLowerCase()));
  const curC = new Set(cur.Candidates.map((c) => c.Keyword.toLowerCase()));
  const prevRank = new Map(prev.Ranked.map((r) => [r.Keyword.toLowerCase(), r.Rank]));
  return {
    NewCandidates: cur.Candidates.filter((c) => !prevC.has(c.Keyword.toLowerCase())).map((c) => c.Keyword),
    DroppedCandidates: prev.Candidates.filter((c) => !curC.has(c.Keyword.toLowerCase())).map((c) => c.Keyword),
    RankMoves: cur.Ranked.flatMap((r) => {
      const was = prevRank.get(r.Keyword.toLowerCase());
      return was !== undefined && was !== r.Rank ? [{ Keyword: r.Keyword, Was: was, Now: r.Rank }] : [];
    }),
  };
}

export function diffGsc(cur: GscResult, prev?: GscResult) {
  if (!prev) return {};
  return {
    Clicks: { Now: cur.Totals.Clicks, Was: prev.Totals.Clicks, Range: cur.Range, PreviousRange: prev.Range },
    Impressions: { Now: cur.Totals.Impressions, Was: prev.Totals.Impressions },
    NewQueries: cur.Queries.filter((q) => !prev.Queries.some((p) => p.Query === q.Query)).slice(0, 20).map((q) => q.Query),
  };
}

const results = <T>(s?: Snapshot) => s?.Results as T | undefined;

/** The watch list's Search Console settings, or their defaults if the file can't be read. */
async function watchSettings(): Promise<Watchlist> {
  return await readWatchlist().catch(() => WatchlistSchema.parse({}));
}

/**
 * The latest answer of each kind, with what changed since the run before. Search Console also carries the six
 * reports (`gsc/reports.ts`), read against the watch list's settings and the latest site check's sitemap.
 *
 * @param dataDir - the vault folder holding `snapshots/`
 * @param watch - the watch list; read from `watchlist.json` (or its defaults) when omitted
 * @returns one entry per kind; a kind never run has `LastRun: null`
 */
export async function current(dataDir: string, watch?: Watchlist) {
  const out: Record<string, unknown> = {};
  for (const kind of KINDS) {
    const [latest, previous] = await readHistory(dataDir, kind, 2);
    if (!latest) {
      out[kind] = { LastRun: null };
      continue;
    }
    const LastRun = new Date(latest.Timestamp).toISOString();
    const PreviousRun = previous ? new Date(previous.Timestamp).toISOString() : null;
    if (kind === "site") {
      const cur = results<SiteReport>(latest)!;
      const counts: Record<string, number> = {};
      for (const i of cur.Issues) counts[i.Kind] = (counts[i.Kind] ?? 0) + 1;
      out.site = { LastRun, PreviousRun, PagesFetched: cur.PagesFetched, SitemapUrls: cur.SitemapUrls.length, IssueCounts: counts, Issues: cur.Issues, Changes: diffSite(cur, results(previous)) };
    } else if (kind === "keywords") {
      const cur = results<KeywordsResult>(latest)!;
      out.keywords = {
        LastRun, PreviousRun, Cost: cur.Cost, Balance: cur.Balance, Settings: cur.Settings ?? null, Sources: cur.Sources,
        Note: cur.Settings ? undefined : "This pull predates the workbench recording its settings and reading SERP domains through Google's redirect (6.2.8): its limits are unknown and its SERP domains read google.com. The next pull records both.",
        WriteNext: cur.Candidates.filter((c) => c.FathymRank === null || c.FathymRank > 10).slice(0, 25),
        Ranked: cur.Ranked.slice(0, 25), Changes: diffKeywords(cur, results(previous)),
      };
    } else if (kind === "searchconsole") {
      const cur = results<GscResult>(latest)!;
      const pulls = (await readHistory(dataDir, "searchconsole", 10)).map((p) => results<GscResult>(p)!);
      out.searchconsole = {
        LastRun, PreviousRun, Range: cur.Range, Totals: cur.Totals, PreviousPeriod: cur.Previous ? { Range: cur.Previous.Range, Totals: cur.Previous.Totals ?? null } : null, TopQueries: cur.Queries.slice(0, 25),
        NotIndexed: cur.Inspected.filter((i) => i.Verdict && i.Verdict !== "PASS"), Sitemaps: cur.Sitemaps,
        Sources: cur.Sources, Changes: diffGsc(cur, results(previous)),
        Reports: searchConsoleReports(pulls, watch ?? await watchSettings(), results<SiteReport>((await readHistory(dataDir, "site", 1))[0])?.SitemapUrls),
      };
    } else {
      const cur = results<OpportunitiesResult>(latest)!;
      out.opportunities = { LastRun, Since: cur.Since, Issues: cur.Issues.length, Mentioning: cur.Issues.filter((i) => i.Mentions.length).slice(0, 30) };
    }
  }
  return out;
}

export async function history(dataDir: string, kind: Kind, limit = 10) {
  return (await readHistory(dataDir, kind, limit)).map((s) => ({ Kind: s.Kind, Timestamp: new Date(s.Timestamp).toISOString(), File: `snapshots/${stamp(s.Timestamp)}-${s.Kind}.json` }));
}

/**
 * Writes the latest results into dev-space; a person reviews and commits them. Each folder is dated by the pull
 * it holds, not by today.
 *
 * @returns the paths written, relative to `devSpace`
 */
export async function exportToDevSpace(dataDir: string, devSpace: string) {
  // Each folder is dated by its own pull, so re-exporting an old pull never files it under today.
  const dated = (sn: Snapshot) => new Date(sn.Timestamp).toISOString().slice(0, 10);
  const report = await current(dataDir);
  const written: string[] = [];
  const write = async (rel: string, text: string) => {
    const p = join(devSpace, rel);
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
    written.push(rel);
  };
  const [kw] = await readHistory(dataDir, "keywords", 1);
  if (kw) {
    const dir = `research/fathym-marketing/demand/${dated(kw)}-search-health`;
    await write(`${dir}/raw/dataforseo/keywords-pull.json`, JSON.stringify(kw.Results, null, 2));
    await write(`${dir}/README.md`, keywordsMarkdown(report.keywords as Record<string, unknown>));
  }
  const [site] = await readHistory(dataDir, "site", 1);
  const [opp] = await readHistory(dataDir, "opportunities", 1);
  const [gsc] = await readHistory(dataDir, "searchconsole", 1);
  if (site || opp || gsc) {
    const dir = `research/fathym-marketing/site-health/${dated([site, gsc, opp].filter(Boolean).sort((a, b) => b!.Timestamp - a!.Timestamp)[0]!)}`;
    if (site) await write(`${dir}/raw/site-check.json`, JSON.stringify(site.Results, null, 2));
    if (opp) await write(`${dir}/raw/opportunities.json`, JSON.stringify(opp.Results, null, 2));
    if (gsc) await write(`${dir}/raw/search-console.json`, JSON.stringify(gsc.Results, null, 2));
    await write(`${dir}/README.md`, siteMarkdown(report));
  }
  return { Written: written, Note: "Written, not committed. Review and commit to dev-space integration." };
}

function keywordsMarkdown(k: Record<string, unknown>): string {
  const rows = (k.WriteNext as { Keyword: string; AdsVolume: number | null; LabsVolume: number | null; Difficulty: number | null; FathymRank: number | null; Serp?: { AiOverview: boolean } }[]) ?? [];
  const st = k.Settings as { Seeds: string[]; RankedLimit: number; IdeasPerSeed: number; SerpTop: number; AdsVolume: boolean } | null;
  const limits = st
    ? `Seeds: ${st.Seeds.join(", ")}. Limits: ${st.RankedLimit} ranked keywords, ${st.IdeasPerSeed} suggestions a seed, SERP for the top ${st.SerpTop}, Google Ads volume ${st.AdsVolume ? "on" : "off"}. "not ranked" means not among the ${st.RankedLimit} ranked keywords pulled.`
    : "This pull's limits were not recorded.";
  return `# Search health: keyword pull\n\nPulled ${k.LastRun}. DataForSEO reported cost: ${k.Cost}. Raw responses in \`raw/dataforseo/\`.\n\n${limits}\n\n` +
    `| Keyword | Google Ads volume | Labs volume | Difficulty | fathym.com rank | AI Overview |\n| --- | --- | --- | --- | --- | --- |\n` +
    rows.map((r) => `| ${r.Keyword} | ${r.AdsVolume ?? "—"} | ${r.LabsVolume ?? "—"} | ${r.Difficulty ?? "—"} | ${r.FathymRank ?? "not ranked"} | ${r.Serp ? (r.Serp.AiOverview ? "yes" : "no") : "not read"} |`).join("\n") +
    `\n\nSources: ${JSON.stringify(k.Sources)}\n`;
}

function siteMarkdown(r: Record<string, unknown>): string {
  const s = r.site as { LastRun: string; PagesFetched: number; IssueCounts: Record<string, number>; Issues: Issue[] } | undefined;
  const o = r.opportunities as { LastRun: string; Since: string; Mentioning: { Repo: string; Number: number; Title: string; Mentions: string[] }[] } | undefined;
  let md = "# Search health: site check\n\n";
  if (s?.LastRun) {
    md += `Checked ${s.LastRun}: ${s.PagesFetched} sitemap pages fetched. Raw result in \`raw/site-check.json\`.\n\n`;
    md += `| Issue | Count |\n| --- | --- |\n${Object.entries(s.IssueCounts).map(([k, v]) => `| ${k} | ${v} |`).join("\n") || "| none | 0 |"}\n\n`;
    md += s.Issues.map((i) => `- **${i.Kind}** ${i.Url}: ${i.Detail} (HTTP ${i.Evidence.Status}, ${i.Evidence.FetchedAt})`).join("\n") + "\n\n";
  }
  const g = r.searchconsole as { LastRun: string; Range: { Start: string; End: string }; Totals: { Clicks: number; Impressions: number }; Reports?: ReturnType<typeof searchConsoleReports> } | undefined;
  if (g?.LastRun && g.Reports) md += gscMarkdown(g as Required<typeof g>);
  if (o?.LastRun) {
    md += `## Opportunities\n\nIssues changed since ${o.Since}, scanned ${o.LastRun}, that mention a watch-list term:\n\n`;
    md += o.Mentioning.map((i) => `- ${i.Repo}#${i.Number} ${i.Title} (${i.Mentions.join(", ")})`).join("\n") + "\n";
  }
  return md;
}

/** The Search Console section of the site-health export: the six reports, each with its source and limits. */
function gscMarkdown(g: { LastRun: string; Range: { Start: string; End: string }; Totals: { Clicks: number; Impressions: number }; Reports: ReturnType<typeof searchConsoleReports> }): string {
  const R = g.Reports;
  const list = <T>(items: T[], line: (i: T) => string, none: string) => (items.length ? items.slice(0, 15).map((i) => `- ${line(i)}`).join("\n") : `- ${none}`) + "\n\n";
  let md = `## Search Console\n\nPulled ${g.LastRun}, ${g.Range.Start} to ${g.Range.End}: ${g.Totals.Clicks} clicks, ${g.Totals.Impressions} impressions (sum of top page rows). Raw pull in \`raw/search-console.json\`.\n\n`;
  const sd = R.StrikingDistance;
  md += `### Striking distance\n\nPositions ${sd.Band.MinPosition}–${sd.Band.MaxPosition}, at least ${sd.Band.MinImpressions} impressions. Source: ${sd.Source}.\n\n`;
  md += list(sd.Queries, (q) => `${q.Query}: position ${q.Position.toFixed(1)}, ${q.Impressions} impressions, ${q.Clicks} clicks`, "No query in the band.");
  const f = R.Falling.VsPreviousPeriod;
  md += `### Falling\n\n` + (f ? `Against ${f.PreviousRange.Start} to ${f.PreviousRange.End}. Source: ${f.Source}.\n\n` + list(f.Pages, (p) => `${p.Page}: clicks ${p.Clicks.Was} → ${p.Clicks.Now}, impressions ${p.Impressions.Was} → ${p.Impressions.Now}`, "No page in the sitemap fell.") + (f.MovedOrRemoved.length ? `Not in the sitemap (moved, removed or never listed), ${f.MovedOrRemoved.length} pages: for a moved page, its loss is usually its new URL's gain.\n\n` : "") + `Queries that fell:\n\n` + list(f.Queries, (q) => `${q.Query}: clicks ${q.Clicks.Was} → ${q.Clicks.Now}, impressions ${q.Impressions.Was} → ${q.Impressions.Now}`, "No query fell.") : "This pull has no previous period.\n\n");
  const lc = R.LowCtr;
  md += `### Low CTR for the position\n\nUnder ${lc.Ratio} × the site's own median CTR at the same rounded position (3+ pages there), at least ${lc.MinImpressions} impressions. Source: ${lc.Source}.\n\n`;
  md += list(lc.Pages, (p) => `${p.Page}: CTR ${(p.Ctr * 100).toFixed(1)}% at position ${p.RoundedPosition}, site median ${(p.SiteMedianCtr * 100).toFixed(1)}% over ${p.PagesAtPosition} pages`, "No page flagged.");
  const c = R.Cannibalisation;
  md += `### Cannibalisation\n\n${c.Note ?? ""} Source: ${c.Source ?? "none"}.\n\n` + list(c.Queries, (q) => `${q.Query}: ${q.Pages.map((p) => `${p.Page} (${p.Impressions})`).join(", ")}`, "No query had two pages in the sitemap with impressions.");
  if (c.Moved.length) md += `Moved (old URL beside its new one), ${c.Moved.length} queries, e.g. ${c.Moved.slice(0, 3).map((q) => q.Query).join("; ")}.\n\n`;
  const b = R.BrandSplit;
  md += `### Branded split\n\nBrand terms: ${b.Brand.join(", ")}. ${b.Note} Source: ${b.Source}.\n\n| | Queries | Clicks | Impressions |\n| --- | --- | --- | --- |\n| Branded | ${b.Branded.Queries} | ${b.Branded.Clicks} | ${b.Branded.Impressions} |\n| Everything else | ${b.NonBranded.Queries} | ${b.NonBranded.Clicks} | ${b.NonBranded.Impressions} |\n\n`;
  const ih = R.IndexingHistory;
  md += `### Indexing history\n\nAcross ${ih.PullsRead} kept pulls. Source: ${ih.Source}.\n\n` + list(ih.Changes, (x) => `${x.Url}: ${x.Before.Verdict} → ${x.Now.Verdict} (${x.Now.Coverage ?? ""})`, "No verdict changed.");
  return md;
}
