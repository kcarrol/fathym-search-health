import { assert, assertEquals, assertRejects } from "@std/assert";
import { DataForSeo, resultDomain, unwrap } from "../src/keywords/dataforseo.ts";
import { estimateCost, pullKeywords } from "../src/keywords/pull.ts";
import { WatchlistSchema } from "../src/watchlist.ts";

const fixture = (name: string) => JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/dataforseo/${name}`, import.meta.url)));

/** Recorded DataForSEO responses (2026-11-20), trimmed, served by endpoint. */
function recorded() {
  const calls: string[] = [];
  const api = new DataForSeo((endpoint) => {
    calls.push(endpoint);
    if (endpoint.includes("user_data")) return Promise.resolve(fixture("user-data.json"));
    if (endpoint.includes("ranked_keywords")) return Promise.resolve(fixture("ranked-keywords.json"));
    if (endpoint.includes("keyword_suggestions")) return Promise.resolve(fixture("keyword-suggestions.json"));
    if (endpoint.includes("serp")) return Promise.resolve(fixture("serp.json"));
    if (endpoint.includes("search_volume")) {
      return Promise.resolve({ status_code: 20000, status_message: "Ok.", cost: 0.09, tasks: [{ status_code: 20000, status_message: "Ok.", result: [{ keyword: "context engineering", search_volume: 4400 }] }] });
    }
    throw new Error(`unexpected ${endpoint}`);
  });
  return { api, calls };
}

Deno.test("dataforseo: a non-20000 status is an error, not an empty result", () => {
  let threw = false;
  try {
    unwrap("/x", { status_code: 40104, status_message: "Please verify your account" });
  } catch (e) {
    threw = String(e).includes("40104");
  }
  assert(threw);
});

Deno.test("dataforseo: the balance keeps only the money, never the account login", async () => {
  const b = await recorded().api.balance();
  assertEquals(b.Result.Balance, 0.0411);
  assert(!JSON.stringify(b.Raw).includes("login"));
});

Deno.test("serp: Google's goto-wrapped results are read by their breadcrumb or site name", () => {
  assertEquals(resultDomain({ domain: "google.com", breadcrumb: "https://www.artifilog.com › Productivity", website_name: "artifilog.com" }), "artifilog.com");
  assertEquals(resultDomain({ domain: "google.com", breadcrumb: "10+ likes", website_name: "Medium" }), "Medium");
  assertEquals(resultDomain({ domain: "www.ibm.com" }), "www.ibm.com");
});

Deno.test("pull: recorded responses give ranked keywords, candidates with sources, and the reported cost", async () => {
  const { api, calls } = recorded();
  const w = WatchlistSchema.parse({ Seeds: ["context engineering"], RankedLimit: 10, IdeasPerSeed: 50, AdsVolume: true, SerpTop: 1 });
  const r = await pullKeywords(w, api);
  assertEquals(calls.filter((c) => c.includes("serp")).length, 1);
  assert(r.Ranked.length > 0 && r.Ranked.every((k) => k.Keyword));
  const top = r.Candidates[0];
  assertEquals(top.Keyword, "context engineering");
  assertEquals(top.LabsVolume, 4400);
  assertEquals(top.AdsVolume, 4400);
  assert(top.Serp && top.Serp.TopDomains.every((d) => d !== "google.com"), JSON.stringify(top.Serp));
  // The cost is the sum of what the responses report: 0.0132 + 0.018 + 0.09 + 0.002 (recorded SERP).
  assertEquals(r.Cost, Number(r.Calls.reduce((s, c) => s + c.Cost, 0).toFixed(6)));
  assert(r.Sources.Ranked && r.Sources.LabsVolume && r.Sources.Serp);
});

Deno.test("pull: stops before any paid call when the estimate is over the limit, or there are no seeds", async () => {
  const { api, calls } = recorded();
  const w = WatchlistSchema.parse({ Seeds: ["a", "b"], MaxEstimatedCost: 0.01 });
  await assertRejects(() => pullKeywords(w, api), Error, "nothing was called");
  await assertRejects(() => pullKeywords(WatchlistSchema.parse({}), api), Error, "no Seeds");
  assertEquals(calls, []);
});

Deno.test("estimate: published prices, live queue; AdsVolume off drops the $0.09 task", () => {
  const w = WatchlistSchema.parse({ Seeds: ["a", "b", "c", "d", "e"] });
  // 0.012 + 1000×0.00012 + 5×0.012 + 500×0.00012 + 0.09 + 20×0.002×2
  assertEquals(Number(estimateCost(w).toFixed(4)), 0.422);
  assertEquals(Number(estimateCost({ ...w, AdsVolume: false }).toFixed(4)), 0.332);
});

Deno.test("pull: excluded terms drop candidates (whole words)", async () => {
  const { api } = recorded();
  const w = WatchlistSchema.parse({ Seeds: ["context engineering"], RankedLimit: 10, IdeasPerSeed: 50, AdsVolume: false, SerpTop: 0, Exclude: ["agentic"] });
  const r = await pullKeywords(w, api);
  assert(r.Candidates.length > 0);
  assert(r.Candidates.every((c) => !/\bagentic\b/i.test(c.Keyword)), r.Candidates.map((c) => c.Keyword).join());
  assertEquals(r.Settings.Exclude, ["agentic"]);
});
