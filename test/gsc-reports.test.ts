/** The six Search Console reports (6.3) over hand-built pulls in the shape `pullSearchConsole` returns. */
import { assertEquals } from "@std/assert";
import type { GscResult } from "../src/gsc/pull.ts";
import { brandSplit, cannibalisation, falling, indexingHistory, lowCtr, strikingDistance } from "../src/gsc/reports.ts";

const settings = { Brand: ["fathym", "fai"], StrikingDistance: { MinPosition: 4, MaxPosition: 20, MinImpressions: 20 }, LowCtrRatio: 0.5 };
const q = (Query: string, Position: number, Impressions: number, Clicks = 0, Ctr = 0) => ({ Query, Position, Impressions, Clicks, Ctr });
const p = (Page: string, Position: number, Impressions: number, Clicks = 0, Ctr = 0) => ({ Page, Position, Impressions, Clicks, Ctr });
const pull = (o: Partial<GscResult> = {}): GscResult => ({
  Property: "sc-domain:fathym.com", PulledAt: "2026-11-24T00:00:00Z", Range: { Start: "2026-10-25", End: "2026-11-21" },
  Totals: { Clicks: 0, Impressions: 0 }, Queries: [], Pages: [], Sitemaps: [], Inspected: [], NextInspectFrom: 0,
  Sources: { Queries: "q-src", Pages: "p-src", QueryPages: "qp-src", Previous: "prev-src" }, ...o,
});

Deno.test("striking distance: inside the band with enough impressions, edges included, sorted by impressions", () => {
  const r = strikingDistance(pull({ Queries: [q("a", 3.9, 500), q("b", 4, 30), q("c", 20, 90), q("d", 20.1, 900), q("e", 10, 19)] }), settings);
  assertEquals(r.Queries.map((x) => x.Query), ["c", "b"]);
  assertEquals(r.Source, "q-src");
  assertEquals(strikingDistance(pull(), settings).Queries, []);
});

Deno.test("falling: rows down against the previous period, worst first; rows not in both are not compared", () => {
  const cur = pull({
    Pages: [p("/a", 5, 100, 2), p("/b", 5, 100, 10), p("/new", 5, 100, 1)],
    Previous: { Range: { Start: "2026-09-27", End: "2026-10-24" }, Queries: [], Pages: [p("/a", 5, 100, 9), p("/b", 5, 100, 10), p("/gone", 5, 100, 50)] },
  });
  const r = falling(cur);
  assertEquals(r.VsPreviousPeriod!.Pages.map((x) => x.Page), ["/a"]);
  assertEquals(r.VsPreviousPeriod!.Pages[0].Clicks, { Now: 2, Was: 9 });
  assertEquals(r.VsLastPull, null);
  assertEquals(falling(pull()).VsPreviousPeriod, null);
});

Deno.test("low CTR: under the ratio of the site's own median at that rounded position; positions with < 3 pages skipped", () => {
  const pages = [p("/x", 3.2, 100, 0, 0.01), p("/y", 2.8, 100, 0, 0.1), p("/z", 3, 100, 0, 0.08), p("/lone", 7, 100, 0, 0.0001), p("/few", 3, 5, 0, 0)];
  const r = lowCtr(pull({ Pages: pages }), settings);
  assertEquals(r.Pages.map((x) => x.Page), ["/x"]);
  assertEquals([r.Pages[0].RoundedPosition, r.Pages[0].SiteMedianCtr, r.Pages[0].PagesAtPosition], [3, 0.08, 3]);
});

Deno.test("cannibalisation: two or more of our pages with impressions on one query; one page per query is not", () => {
  const row = (Query: string, Page: string, Impressions: number) => ({ Query, Page, Impressions, Clicks: 0, Ctr: 0, Position: 5 });
  const r = cannibalisation(pull({ QueryPages: [row("mcp server", "/a", 40), row("mcp server", "/b", 60), row("context", "/c", 90), row("x", "/c", 10), row("x", "/d", 0)] }), settings);
  assertEquals(r.Queries.map((x) => [x.Query, x.Pages.map((pg) => pg.Page)]), [["mcp server", ["/b", "/a"]]]);
  assertEquals(cannibalisation(pull({ QueryPages: undefined }), settings).Queries, []);
});

Deno.test("cannibalisation: brand and site: queries left out; an old URL beside its new one is a move (first real pull, 6.3.3)", () => {
  const row = (Query: string, Page: string, Impressions: number) => ({ Query, Page, Impressions, Clicks: 0, Ctr: 0, Position: 5 });
  const sitemap = new Set(["/blog/local-ai", "/", "/platform"]);
  const r = cannibalisation(pull({
    QueryPages: [
      row("fathym", "/", 37), row("fathym", "/platform", 35),
      row("site:fathym.com", "/", 8), row("site:fathym.com", "/platform", 8),
      row("does local ai use tokens", "/blog/local-ai", 21), row("does local ai use tokens", "/blog/2026/05/19-local-ai", 8),
      row("mcp", "/", 4), row("mcp", "/platform", 3),
    ],
  }), settings, sitemap);
  assertEquals(r.Queries.map((q) => q.Query), ["mcp"]);
  assertEquals(r.Moved.map((q) => q.Query), ["does local ai use tokens"]);
  assertEquals(r.Moved[0].Pages.map((p) => p.InSitemap), [true, false]);
  assertEquals(r.Excluded, 4);
});

Deno.test("falling: pages outside the sitemap are listed apart as moved or removed", () => {
  const cur = pull({
    Pages: [p("/blog/2026/05/19-local-ai", 5, 247, 0), p("/platform", 5, 100, 0)],
    Previous: { Range: { Start: "2026-09-27", End: "2026-10-24" }, Queries: [], Pages: [p("/blog/2026/05/19-local-ai", 5, 2354, 19), p("/platform", 5, 141, 2)] },
  });
  const r = falling(cur, undefined, new Set(["/platform", "/blog/local-ai"]));
  assertEquals(r.VsPreviousPeriod!.Pages.map((x) => x.Page), ["/platform"]);
  assertEquals(r.VsPreviousPeriod!.MovedOrRemoved.map((x) => x.Page), ["/blog/2026/05/19-local-ai"]);
});

Deno.test("brand split: whole-word brand terms only ('fathymic' is not branded)", () => {
  const r = brandSplit(pull({ Queries: [q("fathym workbench", 2, 50, 5), q("what is fai cli", 3, 10, 1), q("fathymic", 9, 7, 0), q("mcp server", 8, 100, 2)] }), settings);
  assertEquals(r.Branded, { Clicks: 6, Impressions: 60, Queries: 2 });
  assertEquals(r.NonBranded, { Clicks: 2, Impressions: 107, Queries: 2 });
});

Deno.test("indexing history: only URLs whose verdict changed since their last inspection", () => {
  const ins = (Url: string, Verdict: string) => ({ Url, Verdict, Coverage: Verdict === "PASS" ? "Submitted and indexed" : "Crawled - currently not indexed" });
  const newest = pull({ PulledAt: "2", Inspected: [ins("/a", "NEUTRAL"), ins("/b", "PASS")] });
  const older = pull({ PulledAt: "1", Inspected: [ins("/a", "PASS"), ins("/b", "PASS"), ins("/c", "PASS")] });
  const r = indexingHistory([newest, older]);
  assertEquals(r.Changes.map((c) => [c.Url, c.Before.Verdict, c.Now.Verdict]), [["/a", "PASS", "NEUTRAL"]]);
  assertEquals(indexingHistory([newest]).Changes, []);
});
