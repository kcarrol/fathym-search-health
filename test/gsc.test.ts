/**
 * Search Console against responses shaped from Google's documented schemas (searchAnalytics.query,
 * urlInspection.index.inspect, sitemaps.list). No real response yet: access is pending (6.2.4).
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { pullSearchConsole } from "../src/gsc/pull.ts";
import { fileTokenSource } from "../src/gsc/auth.ts";

function fakeGoogle() {
  const seen: string[] = [];
  const get = (url: string, init: RequestInit) => {
    seen.push(`${init.method} ${url}`);
    if (url.includes("searchAnalytics")) {
      const dim = JSON.parse(String(init.body)).dimensions[0];
      return Promise.resolve({ rows: [{ keys: [dim === "query" ? "unlimited ai tokens" : "https://www.fathym.com/blog/x"], clicks: 3, impressions: 120, ctr: 0.025, position: 11.2 }] });
    }
    if (url.endsWith("/sitemaps")) return Promise.resolve({ sitemap: [{ path: "https://www.fathym.com/sitemap.xml", lastDownloaded: "2026-11-18T00:00:00Z", errors: "0", warnings: "1" }] });
    if (url.includes("index:inspect")) {
      const u = JSON.parse(String(init.body)).inspectionUrl as string;
      return Promise.resolve({ inspectionResult: { indexStatusResult: { verdict: u.endsWith("/b") ? "NEUTRAL" : "PASS", coverageState: "Submitted and indexed", googleCanonical: u, userCanonical: u, pageFetchState: "SUCCESSFUL" } } });
    }
    throw new Error(url);
  };
  return { get, seen };
}

Deno.test("gsc: queries, pages, sitemaps and a rotating inspection batch, each with its source", async () => {
  const { get, seen } = fakeGoogle();
  const urls = ["https://www.fathym.com/a", "https://www.fathym.com/b", "https://www.fathym.com/c"];
  const r = await pullSearchConsole(get, { Property: "sc-domain:fathym.com", InspectUrls: urls, InspectBatch: 2, InspectFrom: 2 });
  assertEquals(r.Queries[0].Query, "unlimited ai tokens");
  assertEquals(r.Totals, { Clicks: 3, Impressions: 120 });
  assertEquals(r.Sitemaps[0].Warnings, 1);
  assertEquals(r.Inspected.map((i) => i.Url), ["https://www.fathym.com/c", "https://www.fathym.com/a"]);
  assertEquals(r.NextInspectFrom, 1);
  assertStringIncludes(r.Sources.Queries, r.Range.Start);
  assertStringIncludes(seen[0], encodeURIComponent("sc-domain:fathym.com"));
});

Deno.test("gsc: no credential file is a clear error that points at the README", async () => {
  await assertRejects(() => fileTokenSource("/nonexistent/gsc.json")(), Error, "README.md");
});
