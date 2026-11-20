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
