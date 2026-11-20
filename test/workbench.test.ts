/**
 * The fAI layer: the tools in-process (WorkbenchRunner), and the real entry served by `fai run` the way
 * Claude Code and a browser reach it: MCP over stdio, the API over HTTP, and the Web page. The fai CLI is
 * pinned, so the test doesn't depend on a global install.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { initWorkbenchTelemetry, Workbench, WorkbenchRunner } from "@fathym/fai/workbenches";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tools } from "../src/tools.ts";
import type { Fetched } from "../src/site/sitemap.ts";

initWorkbenchTelemetry(); // keeps fAI's debug logging out of the test output

const FAI = "jsr:@fathym/fai@0.0.1009";
const ROOT = fromFileUrl(new URL("..", import.meta.url));
const TOOLS = ["keywords-pull", "opportunities-scan", "report-current", "report-export", "report-history", "searchconsole-pull", "site-check"];

/** A site whose one page loses its canonical between two checks. */
function changingSite() {
  let run = 0;
  return {
    next: () => run++,
    fetch: (url: string): Promise<Fetched> => {
      const path = new URL(url).pathname;
      const base = { Url: url, FetchedAt: new Date().toISOString() };
      if (path === "/robots.txt") return Promise.resolve({ ...base, Status: 200, ContentType: "text/plain", Body: "User-agent: *" });
      if (path === "/sitemap.xml") return Promise.resolve({ ...base, Status: 200, ContentType: "application/xml", Body: "<urlset><url><loc>https://x.test/</loc></url></urlset>" });
      if (path === "/") return Promise.resolve({ ...base, Status: 200, ContentType: "text/html", Body: run === 0 ? `<title>Home</title><link rel="canonical" href="https://x.test/"><h1>h</h1>` : `<title>Home</title><h1>h</h1>` });
      return Promise.resolve({ ...base, Status: 404, ContentType: "text/html", Body: "" });
    },
  };
}

Deno.test("tools: two site checks are kept in the vault, and the second reports what changed", async () => {
  const data = await Deno.makeTempDir({ prefix: "search-health-" });
  const site = changingSite();
  const bench = await WorkbenchRunner(Workbench("t", "t").Tools(tools({ DataDir: () => data, Site: "https://x.test", Fetch: site.fetch }))).Open();
  try {
    const first = await bench.Tools.Site.Check({}) as { Issues: unknown[] };
    assertEquals(first.Issues, []);
    site.next();
    const second = await bench.Tools.Site.Check({}) as { Changes: { New: { Kind: string }[] }; PreviousRun: string };
    assertEquals(second.Changes.New.map((i) => i.Kind), ["canonical-missing"]);
    assert(second.PreviousRun);
    const files = [...Deno.readDirSync(join(data, "snapshots"))].map((e) => e.name);
    assertEquals(files.filter((f) => f.endsWith("-site.json")).length, 2);
    const history = await bench.Tools.Report.History({ Kind: "site" }) as unknown[];
    assertEquals(history.length, 2);
  } finally {
    await bench.Close();
  }
});

Deno.test({
  name: "mcp: fai run serves the seven tools and two prompts over stdio",
  sanitizeOps: false, // the MCP SDK's stdio transport leaves a timer behind
  sanitizeResources: false,
}, async () => {
  const data = await Deno.makeTempDir({ prefix: "search-health-" });
  const transport = new StdioClientTransport({
    command: Deno.execPath(),
    args: ["run", "-A", "--no-config", FAI, "run", "search-health.ts", "--mode", "MCP"],
    cwd: ROOT,
    stderr: "pipe",
    env: { HOME: Deno.env.get("HOME") ?? "", SEARCH_HEALTH_DATA: data, FAI_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "search-health-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assertEquals(tools.map((t) => t.name).sort(), TOOLS);
    const { prompts } = await client.listPrompts();
    assertEquals(prompts.map((p) => p.name).sort(), ["opportunity-review", "weekly-site-review"]);
    const result = await client.callTool({ name: "report-current", arguments: {} });
    const text = (result.content as { text: string }[])[0].text;
    assert(!result.isError, text);
    assertStringIncludes(text, '"LastRun":null');
  } finally {
    await client.close();
  }
});

/** Starts `fai run --mode <mode>` on a port of our choosing and waits for its /health. */
async function serve(mode: "API" | "Web", data: string) {
  const port = 49_000 + Math.floor(Math.random() * 9_000);
  const config = mode === "API" ? { Transport: port } : { Port: port };
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--no-config", FAI, "run", "search-health.ts", "--mode", mode, "--config", JSON.stringify(config)],
    cwd: ROOT,
    env: { SEARCH_HEALTH_DATA: data, FAI_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", NO_COLOR: "1" },
    stdout: "null",
    stderr: "null",
  }).spawn();
  const url = `http://localhost:${port}`;
  const stop = async () => {
    child.kill();
    await child.status;
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${url}/health`).then((r) => (r.body?.cancel(), r.ok)).catch(() => false);
    if (ok) return { url, stop };
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`fai run --mode ${mode} did not answer on ${port}`);
}

Deno.test({ name: "api and web: fai run serves the REST routes, the OpenAPI catalog and the page", sanitizeResources: false, sanitizeOps: false }, async () => {
  const data = await Deno.makeTempDir({ prefix: "search-health-" });
  const api = await serve("API", data);
  try {
    const catalog = await (await fetch(`${api.url}/openapi.json`)).json();
    assert("/report/current" in catalog.paths && "/site/check" in catalog.paths, Object.keys(catalog.paths).join());
    const res = await fetch(`${api.url}/keywords/pull`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ DryRun: true }) });
    const dry = await res.json();
    assertEquals(dry.MaxEstimatedCost, 1); // a dry run, from the committed watch list: nothing paid was called
    assert(dry.EstimatedCost > 0);
  } finally {
    await api.stop();
  }
  const web = await serve("Web", data);
  try {
    assertEquals((await fetch(`${web.url}/health`)).status, 200);
    const page = await (await fetch(`${web.url}/`)).text();
    assertStringIncludes(page, "Is fathym.com healthy, and what should we write next?");
    assertEquals((await (await fetch(`${web.url}/report.json`)).json()).site.LastRun, null);
  } finally {
    await web.stop();
  }
});
