/**
 * Search Console against responses shaped from Google's documented schemas (searchAnalytics.query,
 * urlInspection.index.inspect, sitemaps.list). No real response yet: access is pending (6.2.4).
 */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { pullSearchConsole } from "../src/gsc/pull.ts";
import { fileTokenSource } from "../src/gsc/auth.ts";
import { join } from "@std/path";

function fakeGoogle() {
  const seen: string[] = [];
  const ranges: string[] = [];
  const get = (url: string, init: RequestInit) => {
    seen.push(`${init.method} ${url}`);
    if (url.includes("searchAnalytics") && !ranges.length) ranges.push(JSON.parse(String(init.body)).startDate);
    if (url.includes("searchAnalytics")) {
      const { dimensions, startDate } = JSON.parse(String(init.body));
      const value = (d: string) => (d === "query" ? "unlimited ai tokens" : "https://www.fathym.com/blog/x");
      const clicks = startDate === ranges[0] ? 3 : 5;
      return Promise.resolve({ rows: [{ keys: dimensions.map(value), clicks, impressions: 120, ctr: 0.025, position: 11.2 }] });
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
  const many = Array.from({ length: 12 }, (_, i) => `https://www.fathym.com/p${i}`);
  const r2 = await pullSearchConsole(fakeGoogle().get, { Property: "sc-domain:fathym.com", InspectUrls: many, InspectBatch: 12 });
  assertEquals(r2.Inspected.map((i) => i.Url), many, "inspected five at a time, kept in batch order");
  assertEquals(r.NextInspectFrom, 1);
  assertStringIncludes(r.Sources.Queries, r.Range.Start);
  assertStringIncludes(seen[0], encodeURIComponent("sc-domain:fathym.com"));
});

Deno.test("gsc: query+page rows and the previous period of the same length, each with its source", async () => {
  const { get } = fakeGoogle();
  const r = await pullSearchConsole(get, { Property: "sc-domain:fathym.com", Days: 28 });
  assertEquals(r.QueryPages![0], { Query: "unlimited ai tokens", Page: "https://www.fathym.com/blog/x", Clicks: 3, Impressions: 120, Ctr: 0.025, Position: 11.2 });
  const day = 86_400_000;
  const [s, e, ps, pe] = [r.Range.Start, r.Range.End, r.Previous!.Range.Start, r.Previous!.Range.End].map((d) => Date.parse(d));
  assertEquals((e - s) / day, (pe - ps) / day);
  assertEquals((s - pe) / day, 1);
  assertEquals(r.Previous!.Pages[0].Clicks, 5);
  assertEquals(r.Previous!.Totals, { Clicks: 5, Impressions: 120 });
  assertStringIncludes(r.Sources.QueryPages, "[query,page]");
  assertStringIncludes(r.Sources.Previous, r.Previous!.Range.Start);
});

Deno.test("gsc: no credential file is a clear error that points at the README", async () => {
  await assertRejects(() => fileTokenSource("/nonexistent/gsc.json")(), Error, "README.md");
});

Deno.test("gsc: an OAuth refresh-token file is exchanged read-only, and the token is reused until it expires", async () => {
  const path = join(await Deno.makeTempDir(), "gsc.json");
  await Deno.writeTextFile(path, JSON.stringify({ client_id: "id", client_secret: "s", refresh_token: "rt" }));
  const calls: URLSearchParams[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    calls.push(new URLSearchParams(String(init?.body)));
    return Promise.resolve(Response.json({ access_token: "at", expires_in: 3599 }));
  };
  try {
    const token = fileTokenSource(path);
    assertEquals([await token(), await token()], ["at", "at"]);
    assertEquals(calls.length, 1);
    assertEquals([calls[0].get("grant_type"), calls[0].get("refresh_token"), calls[0].get("client_id")], ["refresh_token", "rt", "id"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("gsc: Google refusing the refresh token is an error with Google's words", async () => {
  const path = join(await Deno.makeTempDir(), "gsc.json");
  await Deno.writeTextFile(path, JSON.stringify({ client_id: "id", client_secret: "s", refresh_token: "rt" }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 }));
  try {
    await assertRejects(() => fileTokenSource(path)(), Error, "invalid_grant Token has been expired or revoked.");
  } finally {
    globalThis.fetch = realFetch;
  }
});
