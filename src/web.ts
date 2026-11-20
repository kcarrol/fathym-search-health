// deno-lint-ignore-file no-explicit-any
/**
 * The Web mode's page: the current answer for a person. `GET /` renders it, `GET /report.json` is the same
 * data. Reads the vault only; it never runs a check (that's the tools' job, from MCP or the API).
 */
import { dataDir } from "./config.ts";
import { current } from "./report/report.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const when = (t: unknown) => (t ? esc(t) : "never run");

function page(r: any): string {
  const site = r.site ?? {};
  const kw = r.keywords ?? {};
  const gsc = r.searchconsole ?? {};
  const opp = r.opportunities ?? {};
  const rows = (items: string[][]) => items.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Search health</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#666;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#e8eaf0;--mut:#9aa;--line:#2a3350}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid var(--line)}small,.m{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
.wrap{overflow-x:auto}</style></head><body>
<h1>Is fathym.com healthy, and what should we write next?</h1>
<p class="m">Read from the workbench's last runs. Run the checks from an AI (MCP) or the API; this page only shows them.</p>

<h2>Site health <small>last run ${when(site.LastRun)}</small></h2>
${site.LastRun ? `<p>${esc(site.PagesFetched)} sitemap pages fetched. ${site.Issues?.length ?? 0} issues.
${site.Changes ? ` Since ${when(site.PreviousRun)}: ${site.Changes.New?.length ?? 0} new, ${site.Changes.Fixed?.length ?? 0} fixed; sitemap +${site.Changes.SitemapAdded?.length ?? 0} / −${site.Changes.SitemapRemoved?.length ?? 0}.` : ""}</p>
<div class="wrap"><table><tr><th>Issue</th><th>URL</th><th>Detail</th><th>Fetched</th></tr>${rows((site.Issues ?? []).map((i: any) => [esc(i.Kind), `<a href="${esc(i.Url)}">${esc(i.Url)}</a>`, esc(i.Detail), `${esc(i.Evidence?.Status)} · ${esc(i.Evidence?.FetchedAt)}`]))}</table></div>` : ""}

<h2>Write next <small>last pull ${when(kw.LastRun)}${kw.Cost !== undefined ? ` · DataForSEO cost ${esc(kw.Cost)}` : ""}</small></h2>
${kw.LastRun ? `<div class="wrap"><table><tr><th>Keyword</th><th>Google Ads volume</th><th>Labs volume</th><th>Difficulty</th><th>fathym.com rank</th><th>AI Overview</th></tr>${rows((kw.WriteNext ?? []).map((c: any) => [esc(c.Keyword), esc(c.AdsVolume ?? "—"), esc(c.LabsVolume ?? "—"), esc(c.Difficulty ?? "—"), esc(c.FathymRank ?? "not ranked"), c.Serp ? (c.Serp.AiOverview ? "yes" : "no") : "not read"]))}</table></div>
<p class="m">Sources: ${esc(Object.values(kw.Sources ?? {}).join(" · "))}</p>` : ""}

<h2>Search Console <small>last pull ${when(gsc.LastRun)}</small></h2>
${gsc.LastRun ? `<p>${esc(gsc.Range?.Start)} to ${esc(gsc.Range?.End)}: ${esc(gsc.Totals?.Clicks)} clicks, ${esc(gsc.Totals?.Impressions)} impressions (top rows). ${esc(gsc.NotIndexed?.length ?? 0)} inspected URLs not passing.</p>` : ""}

<h2>Opportunities <small>last scan ${when(opp.LastRun)}</small></h2>
${opp.LastRun ? `<p>${esc(opp.Issues)} issues changed since ${esc(opp.Since)}; these mention a watch-list term:</p>
<ul>${(opp.Mentioning ?? []).map((i: any) => `<li><a href="${esc(i.Url)}">${esc(i.Repo)}#${esc(i.Number)}</a> ${esc(i.Title)} <small>(${esc(i.Mentions.join(", "))})</small></li>`).join("")}</ul>` : ""}
</body></html>`;
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (url.pathname === "/report.json") return Response.json(await current(dataDir()));
  if (url.pathname === "/") return new Response(page(await current(dataDir())), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response("Not Found", { status: 404 });
}
