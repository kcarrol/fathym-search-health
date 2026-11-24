/**
 * SearchConsole.Pull: fathym.com as Google sees it. Search Analytics (queries and pages), URL Inspection over
 * a rotating batch of sitemap URLs (per-site quota "2000 QPD", "600 QPM"), and the sitemaps Google read. Also
 * queries and pages together (for cannibalisation) and the previous period of the same length (for decay), so
 * the reports in `reports.ts` work from one pull. Every figure carries the call and the date range it came from.
 */
import type { TokenSource } from "./auth.ts";

export type GscFetch = (url: string, init: RequestInit) => Promise<unknown>;

export function httpGscFetch(token: TokenSource): GscFetch {
  return async (url, init) => {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Search Console ${new URL(url).pathname} answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };
}

const WM = "https://www.googleapis.com/webmasters/v3";
const INSPECT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export interface GscOptions {
  /** `sc-domain:fathym.com` for a domain property, or `https://www.fathym.com/` for a URL-prefix one. */
  Property: string;
  /** Days of Search Analytics, ending 3 days ago ("Data is typically available after 2-3 days"). */
  Days?: number;
  RowLimit?: number;
  /** Rows for the query+page call, which has many more combinations. */
  QueryPageRowLimit?: number;
  /** URLs to inspect this run, and where in the sitemap list to start. */
  InspectUrls?: string[];
  InspectBatch?: number;
  InspectFrom?: number;
}

interface AnalyticsRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

export interface GscResult {
  Property: string;
  PulledAt: string;
  Range: { Start: string; End: string };
  Totals: { Clicks: number; Impressions: number };
  Queries: { Query: string; Clicks: number; Impressions: number; Ctr: number; Position: number }[];
  Pages: { Page: string; Clicks: number; Impressions: number; Ctr: number; Position: number }[];
  /** Queries and pages together, this period. Absent in pulls before 6.3. */
  QueryPages?: { Query: string; Page: string; Clicks: number; Impressions: number; Ctr: number; Position: number }[];
  /** The period of the same length before this one. Absent in pulls before 6.3. */
  Previous?: {
    Range: { Start: string; End: string };
    Queries: GscResult["Queries"];
    Pages: GscResult["Pages"];
  };
  Sitemaps: { Path: string; LastSubmitted?: string; LastDownloaded?: string; Errors: number; Warnings: number }[];
  Inspected: {
    Url: string; Verdict?: string; Coverage?: string; Indexing?: string; PageFetch?: string; Robots?: string;
    LastCrawl?: string; GoogleCanonical?: string; UserCanonical?: string;
  }[];
  /** Where the next run's URL Inspection batch starts. */
  NextInspectFrom: number;
  Sources: Record<string, string>;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function pullSearchConsole(get: GscFetch, o: GscOptions): Promise<GscResult> {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - ((o.Days ?? 28) - 1) * 86_400_000);
  const range = { Start: day(start), End: day(end) };
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevRange = { Start: day(new Date(prevEnd.getTime() - ((o.Days ?? 28) - 1) * 86_400_000)), End: day(prevEnd) };
  const site = encodeURIComponent(o.Property);
  const analytics = (dimensions: string[], r = range, rowLimit = o.RowLimit ?? 1000) =>
    get(`${WM}/sites/${site}/searchAnalytics/query`, {
      method: "POST",
      body: JSON.stringify({ startDate: r.Start, endDate: r.End, dimensions, rowLimit }),
    }).then((res) => ((res as { rows?: AnalyticsRow[] }).rows ?? []));

  const [queries, pages, queryPages, prevQueries, prevPages, sitemaps] = await Promise.all([
    analytics(["query"]),
    analytics(["page"]),
    analytics(["query", "page"], range, o.QueryPageRowLimit ?? 5000),
    analytics(["query"], prevRange),
    analytics(["page"], prevRange),
    get(`${WM}/sites/${site}/sitemaps`, { method: "GET" }),
  ]);

  const urls = o.InspectUrls ?? [];
  const from = urls.length ? (o.InspectFrom ?? 0) % urls.length : 0;
  const batch = urls.length ? [...urls, ...urls].slice(from, from + Math.min(o.InspectBatch ?? 100, urls.length)) : [];
  const inspected: GscResult["Inspected"] = [];
  for (const url of batch) {
    const r = await get(INSPECT, { method: "POST", body: JSON.stringify({ inspectionUrl: url, siteUrl: o.Property }) }) as {
      inspectionResult?: { indexStatusResult?: Record<string, string> };
    };
    const s = r.inspectionResult?.indexStatusResult ?? {};
    inspected.push({
      Url: url, Verdict: s.verdict, Coverage: s.coverageState, Indexing: s.indexingState, PageFetch: s.pageFetchState,
      Robots: s.robotsTxtState, LastCrawl: s.lastCrawlTime, GoogleCanonical: s.googleCanonical, UserCanonical: s.userCanonical,
    });
  }

  const row = (r: AnalyticsRow) => ({ Clicks: r.clicks, Impressions: r.impressions, Ctr: r.ctr, Position: r.position });
  return {
    Property: o.Property,
    PulledAt: new Date().toISOString(),
    Range: range,
    Totals: {
      Clicks: pages.reduce((s, r) => s + r.clicks, 0),
      Impressions: pages.reduce((s, r) => s + r.impressions, 0),
    },
    Queries: queries.map((r) => ({ Query: r.keys[0], ...row(r) })),
    Pages: pages.map((r) => ({ Page: r.keys[0], ...row(r) })),
    QueryPages: queryPages.map((r) => ({ Query: r.keys[0], Page: r.keys[1], ...row(r) })),
    Previous: {
      Range: prevRange,
      Queries: prevQueries.map((r) => ({ Query: r.keys[0], ...row(r) })),
      Pages: prevPages.map((r) => ({ Page: r.keys[0], ...row(r) })),
    },
    Sitemaps: ((sitemaps as { sitemap?: Record<string, string>[] }).sitemap ?? []).map((m) => ({
      Path: m.path, LastSubmitted: m.lastSubmitted, LastDownloaded: m.lastDownloaded,
      Errors: Number(m.errors ?? 0), Warnings: Number(m.warnings ?? 0),
    })),
    Inspected: inspected,
    NextInspectFrom: urls.length ? (from + batch.length) % urls.length : 0,
    Sources: {
      Queries: `searchAnalytics.query dimensions=[query] ${range.Start}..${range.End}`,
      Pages: `searchAnalytics.query dimensions=[page] ${range.Start}..${range.End}`,
      QueryPages: `searchAnalytics.query dimensions=[query,page] ${range.Start}..${range.End}`,
      Previous: `searchAnalytics.query dimensions=[query] and [page] ${prevRange.Start}..${prevRange.End}`,
      Totals: "sum of the page rows (the API returns top rows, not every row)",
      Sitemaps: "sitemaps.list",
      Inspected: "urlInspection.index.inspect",
    },
  };
}
