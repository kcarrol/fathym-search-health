import { assertEquals } from "@std/assert";
import { mentions, scanOpportunities } from "../src/opportunities/scan.ts";

Deno.test("mentions: whole words, any case; 'fAI' is not in 'failed'", () => {
  assertEquals(mentions("The build failed", ["fAI"]), []);
  assertEquals(mentions("run fai, then OPENX", ["fAI", "OpenX", "MCP"]), ["fAI", "OpenX"]);
  assertEquals(mentions("see AGENTS.md", ["AGENTS.md"]), ["AGENTS.md"]);
});

Deno.test("scan: skips pull requests, pages until a short page, and puts mentions first", async () => {
  const paths: string[] = [];
  const get = (path: string) => {
    paths.push(path);
    const repo = path.split("/")[3];
    if (repo !== "a") return Promise.resolve([]);
    const page = Number(new URL(`https://x${path}`).searchParams.get("page"));
    if (page === 1) {
      return Promise.resolve(Array.from({ length: 100 }, (_, n) => ({ number: n, title: n === 7 ? "Workbench sitemap" : `t${n}`, html_url: `u${n}`, state: "open", updated_at: `2026-11-1${n % 10}`, body: null })));
    }
    return Promise.resolve([{ number: 200, title: "a PR", html_url: "p", state: "open", updated_at: "2026-11-20", pull_request: {} }]);
  };
  const r = await scanOpportunities(get, ["workbench", "sitemap"], "2026-11-01T00:00:00Z", ["o/a", "o/b"]);
  assertEquals(r.Issues.length, 100);
  assertEquals(r.Issues[0].Number, 7);
  assertEquals(r.Issues[0].Mentions, ["workbench", "sitemap"]);
  assertEquals(paths.filter((p) => p.includes("/o/a/")).length, 2);
});
