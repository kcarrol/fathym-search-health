// deno-lint-ignore-file no-explicit-any
/**
 * The Web mode's page: the current answer for a person. `GET /` renders it, `GET /report.json` is the same
 * data. Reads the vault only; it never runs a check (that's the tools' job, from MCP or the API).
 */
import { dataDir } from "./config.ts";
import { current } from "./report/report.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const when = (t: unknown) => (t ? esc(t) : "never run");

const table = (head: string[], body: string[][], none: string) =>
  body.length
    ? `<div class="wrap"><table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${body.map((c) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table></div>`
    : `<p class="m">${none}</p>`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The six Search Console reports (6.3); each says its source. */
function gscReports(R: any): string {
  if (!R) return "";
  const sd = R.StrikingDistance, f = R.Falling?.VsPreviousPeriod, lc = R.LowCtr, c = R.Cannibalisation, b = R.BrandSplit, ih = R.IndexingHistory;
  return `
<h3>Striking distance <small>positions ${esc(sd.Band.MinPosition)}–${esc(sd.Band.MaxPosition)}, ≥ ${esc(sd.Band.MinImpressions)} impressions · ${esc(sd.Source)}</small></h3>
${table(["Query", "Position", "Impressions", "Clicks"], sd.Queries.slice(0, 25).map((q: any) => [esc(q.Query), esc(q.Position.toFixed(1)), esc(q.Impressions), esc(q.Clicks)]), "No query in the band.")}
<h3>Falling <small>${f ? `against ${esc(f.PreviousRange.Start)} to ${esc(f.PreviousRange.End)} · ${esc(f.Source)}` : "no previous period in this pull"}</small></h3>
${f ? table(["Page", "Clicks", "Impressions"], f.Pages.slice(0, 25).map((p: any) => [esc(p.Page), `${esc(p.Clicks.Was)} → ${esc(p.Clicks.Now)}`, `${esc(p.Impressions.Was)} → ${esc(p.Impressions.Now)}`]), "No page in the sitemap fell.") : ""}
${f ? table(["Query", "Clicks", "Impressions"], f.Queries.slice(0, 25).map((q: any) => [esc(q.Query), `${esc(q.Clicks.Was)} → ${esc(q.Clicks.Now)}`, `${esc(q.Impressions.Was)} → ${esc(q.Impressions.Now)}`]), "No query fell.") : ""}
${f?.MovedOrRemoved?.length ? `<p class="m">${esc(f.MovedOrRemoved.length)} pages not in the sitemap (moved, removed or never listed) are left out: for a moved page, its loss is usually its new URL's gain.</p>` : ""}
<h3>Low CTR for the position <small>under ${esc(lc.Ratio)} × the site's own median at that position · ${esc(lc.Source)}</small></h3>
${table(["Page", "Position", "CTR", "Site median", "Impressions"], lc.Pages.slice(0, 25).map((p: any) => [esc(p.Page), esc(p.RoundedPosition), pct(p.Ctr), pct(p.SiteMedianCtr), esc(p.Impressions)]), "No page flagged.")}
<h3>Cannibalisation <small>${esc(c.Source ?? "no query+page rows")}</small></h3>
<p class="m">${esc(c.Note)}</p>
${table(["Query", "Our pages (impressions)"], c.Queries.slice(0, 25).map((q: any) => [esc(q.Query), q.Pages.map((p: any) => `${esc(p.Page)} (${esc(p.Impressions)})${p.InSitemap ? "" : " <small>not in sitemap</small>"}`).join("<br>")]), "No query had two pages in the sitemap with impressions.")}
<h3>Branded split <small>${esc(b.Brand.join(", "))} · ${esc(b.Note)}</small></h3>
${table(["", "Queries", "Clicks", "Impressions"], [["Branded", esc(b.Branded.Queries), esc(b.Branded.Clicks), esc(b.Branded.Impressions)], ["Everything else", esc(b.NonBranded.Queries), esc(b.NonBranded.Clicks), esc(b.NonBranded.Impressions)]], "")}
<h3>Indexing history <small>across ${esc(ih.PullsRead)} kept pulls</small></h3>
${table(["URL", "Before", "Now"], ih.Changes.map((x: any) => [esc(x.Url), esc(x.Before.Verdict), `${esc(x.Now.Verdict)} <small>${esc(x.Now.Coverage)}</small>`]), "No verdict changed.")}`;
}

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
h1{font-size:22px}h2{font-size:17px;margin-top:28px;border-bottom:1px solid var(--line)}h3{font-size:15px;margin:18px 0 6px}small,.m{color:var(--mut)}
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
${gsc.LastRun ? `<p>${esc(gsc.Range?.Start)} to ${esc(gsc.Range?.End)}: ${esc(gsc.Totals?.Clicks)} clicks, ${esc(gsc.Totals?.Impressions)} impressions (top rows). ${esc(gsc.NotIndexed?.length ?? 0)} inspected URLs not passing.</p>${gscReports(gsc.Reports)}` : ""}

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
