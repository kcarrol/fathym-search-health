/** The Web page renders the Search Console reports from the vault (6.3), each with its source. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { stamp } from "../src/vault/SnapshotVault.ts";

Deno.test("web: the page shows the six Search Console reports, and marks a page outside the sitemap", async () => {
  const data = await Deno.makeTempDir();
  await Deno.mkdir(join(data, "snapshots"));
  const put = (ms: number, Kind: string, Results: unknown) => Deno.writeTextFile(join(data, "snapshots", `${stamp(ms)}-${Kind}.json`), JSON.stringify({ Timestamp: ms, Kind, Results }));
  const row = (Query: string, Page: string, Impressions: number) => ({ Query, Page, Impressions, Clicks: 0, Ctr: 0, Position: 5 });
  await put(1_000_000, "site", { Site: "s", CheckedAt: "t", SitemapUrls: ["/a", "/b"], PagesFetched: 2, LinksChecked: 0, Issues: [] });
  await put(2_000_000, "searchconsole", {
    Property: "sc-domain:fathym.com", PulledAt: "p", Range: { Start: "2026-10-25", End: "2026-11-21" }, Totals: { Clicks: 1, Impressions: 9 },
    Queries: [{ Query: "holonic", Clicks: 0, Impressions: 65, Ctr: 0, Position: 8.2923 }], Pages: [],
    QueryPages: [row("mcp", "/a", 4), row("mcp", "/b", 3), row("old post", "/a", 9), row("old post", "/2026/old", 2)],
    Previous: { Range: { Start: "2026-09-27", End: "2026-10-24" }, Totals: { Clicks: 0, Impressions: 0 }, Queries: [], Pages: [] },
    Sitemaps: [], Inspected: [], NextInspectFrom: 0, Sources: { Queries: "q-src", Pages: "p-src", QueryPages: "qp-src", Previous: "prev-src" },
  });
  const before = Deno.env.get("SEARCH_HEALTH_DATA");
  Deno.env.set("SEARCH_HEALTH_DATA", data);
  const { handler } = await import("../src/web.ts");
  const res = await handler(new Request("http://localhost/")).finally(() => before === undefined ? Deno.env.delete("SEARCH_HEALTH_DATA") : Deno.env.set("SEARCH_HEALTH_DATA", before));
  assertEquals(res.status, 200);
  const html = await res.text();
  for (const h of ["Striking distance", "Falling", "Low CTR for the position", "Cannibalisation", "Branded split", "Indexing history"]) assertStringIncludes(html, `<h3>${h}`);
  assertStringIncludes(html, "holonic</td><td>8.3</td>");
  assertStringIncludes(html, "q-src");
  assert(!html.includes("old post"), "an old URL beside its new one is a move, not cannibalisation");
  assertStringIncludes(html, "No page in the sitemap fell.");
});
