import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { current, diffKeywords, diffSite, exportToDevSpace } from "../src/report/report.ts";
import { stamp } from "../src/vault/SnapshotVault.ts";
import type { SiteReport } from "../src/site/check.ts";

const issue = (Kind: string, Url: string) => ({ Kind, Url, Detail: "d", Evidence: { Status: 404, FetchedAt: "t" } }) as SiteReport["Issues"][number];
const site = (issues: SiteReport["Issues"], urls: string[]): SiteReport => ({ Site: "s", CheckedAt: "t", SitemapUrls: urls, PagesFetched: urls.length, LinksChecked: 0, Issues: issues });

Deno.test("diff: site issues new, fixed and unchanged, and sitemap drift", () => {
  const prev = site([issue("broken-link", "a"), issue("soft-200", "b")], ["/1", "/2"]);
  const cur = site([issue("broken-link", "a"), issue("multiple-h1", "c")], ["/2", "/3"]);
  const d = diffSite(cur, prev);
  assertEquals(d.New.map((i) => i.Kind), ["multiple-h1"]);
  assertEquals(d.Fixed.map((i) => i.Kind), ["soft-200"]);
  assertEquals(d.Unchanged, 1);
  assertEquals([d.SitemapAdded, d.SitemapRemoved], [["/3"], ["/1"]]);
  assertEquals(diffSite(cur).New, []);
});

Deno.test("diff: keyword candidates and rank moves", () => {
  const k = (cands: string[], ranked: [string, number][]) => ({ Candidates: cands.map((Keyword) => ({ Keyword })), Ranked: ranked.map(([Keyword, Rank]) => ({ Keyword, Rank })) }) as never;
  const d = diffKeywords(k(["x", "y"], [["fathym", 1], ["holonic", 20]]), k(["y", "z"], [["fathym", 1], ["holonic", 25]]));
  assertEquals(d.NewCandidates, ["x"]);
  assertEquals(d.DroppedCandidates, ["z"]);
  assertEquals(d.RankMoves, [{ Keyword: "holonic", Was: 25, Now: 20 }]);
});

Deno.test("current and export: read the snapshot files; export writes into dev-space and commits nothing", async () => {
  const data = await Deno.makeTempDir();
  const dev = await Deno.makeTempDir();
  await Deno.mkdir(join(data, "snapshots"));
  const put = (ms: number, Kind: string, Results: unknown) => Deno.writeTextFile(join(data, "snapshots", `${stamp(ms)}-${Kind}.json`), JSON.stringify({ Timestamp: ms, Kind, Results }));
  await put(1_000_000, "site", site([issue("soft-200", "b")], ["/1"]));
  await put(2_000_000, "site", site([issue("broken-link", "a")], ["/1"]));
  const r = await current(data) as Record<string, { LastRun: string | null; IssueCounts?: Record<string, number>; Changes?: { New: unknown[]; Fixed: unknown[] } }>;
  assertEquals(r.site.IssueCounts, { "broken-link": 1 });
  assertEquals([r.site.Changes!.New.length, r.site.Changes!.Fixed.length], [1, 1]);
  assertEquals(r.keywords.LastRun, null);
  const e = await exportToDevSpace(data, dev);
  assert(e.Written.some((p) => p.endsWith("site-health/" + new Date().toISOString().slice(0, 10) + "/README.md")));
  assert((await Deno.readTextFile(join(dev, e.Written.find((p) => p.endsWith("README.md"))!))).includes("broken-link"));
});

Deno.test("current and export: Search Console pulls carry the six reports, and the export gets a section", async () => {
  const data = await Deno.makeTempDir();
  const dev = await Deno.makeTempDir();
  await Deno.mkdir(join(data, "snapshots"));
  const gsc = (PulledAt: string, verdict: string) => ({
    Property: "sc-domain:fathym.com", PulledAt, Range: { Start: "2026-10-25", End: "2026-11-21" }, Totals: { Clicks: 1, Impressions: 50 },
    Queries: [{ Query: "fathym workbench", Clicks: 1, Impressions: 50, Ctr: 0.02, Position: 6 }], Pages: [], QueryPages: [],
    Previous: { Range: { Start: "2026-09-27", End: "2026-10-24" }, Queries: [], Pages: [] }, Sitemaps: [],
    Inspected: [{ Url: "https://www.fathym.com/a", Verdict: verdict }], NextInspectFrom: 0,
    Sources: { Queries: "q", Pages: "p", QueryPages: "qp", Previous: "prev" },
  });
  const put = (ms: number, Results: unknown) => Deno.writeTextFile(join(data, "snapshots", `${stamp(ms)}-searchconsole.json`), JSON.stringify({ Timestamp: ms, Kind: "searchconsole", Results }));
  await put(1_000_000, gsc("1", "PASS"));
  await put(2_000_000, gsc("2", "NEUTRAL"));
  const watch = { Brand: ["fathym"], StrikingDistance: { MinPosition: 4, MaxPosition: 20, MinImpressions: 20 }, LowCtrRatio: 0.5 } as never;
  const r = await current(data, watch) as { searchconsole: { Reports: { StrikingDistance: { Queries: unknown[] }; BrandSplit: { Branded: { Clicks: number } }; IndexingHistory: { Changes: unknown[] } } } };
  assertEquals(r.searchconsole.Reports.StrikingDistance.Queries.length, 1);
  assertEquals(r.searchconsole.Reports.BrandSplit.Branded.Clicks, 1);
  assertEquals(r.searchconsole.Reports.IndexingHistory.Changes.length, 1);
  const e = await exportToDevSpace(data, dev);
  const md = await Deno.readTextFile(join(dev, e.Written.find((p) => p.endsWith("README.md"))!));
  assert(md.includes("### Striking distance") && md.includes("fathym workbench") && md.includes("PASS → NEUTRAL"));
});
