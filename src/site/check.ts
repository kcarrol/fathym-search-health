/**
 * Site.Check: is fathym.com healthy for search engines and AI crawlers? Reads robots.txt and the sitemap,
 * fetches every sitemap URL, probes URLs that should not exist, and follows internal links. Each issue
 * names its URL and what was fetched when; nothing here is estimated.
 */
import { readPage, samePage } from "./html.ts";
import { type Fetched, type Fetcher, sitemapUrls } from "./sitemap.ts";

export const ISSUE_KINDS = [
  "robots-missing",
  "sitemap-missing",
  "sitemap-url-error",
  "sitemap-url-redirects",
  "soft-200",
  "canonical-missing",
  "canonical-elsewhere",
  "noindex-in-sitemap",
  "title-missing",
  "duplicate-title",
  "multiple-h1",
  "broken-link",
] as const;
export type IssueKind = typeof ISSUE_KINDS[number];

export interface Issue {
  Kind: IssueKind;
  Url: string;
  Detail: string;
  Evidence: { Status: number; FetchedAt: string; [k: string]: unknown };
}

export interface SiteReport {
  Site: string;
  CheckedAt: string;
  SitemapUrls: string[];
  PagesFetched: number;
  LinksChecked: number;
  Issues: Issue[];
}

export interface CheckOptions {
  Concurrency?: number;
  /** How many internal link targets outside the sitemap to check at most. */
  MaxLinks?: number;
  /** Paths that should not exist, probed for soft-200s. Random by default. */
  ProbePaths?: string[];
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const at = i++;
      out[at] = await fn(items[at]);
    }
  }));
  return out;
}

const ev = (f: Fetched, extra: Record<string, unknown> = {}) => ({ Status: f.Status, FetchedAt: f.FetchedAt, ...extra });

export async function checkSite(site: string, get: Fetcher, opts: CheckOptions = {}): Promise<SiteReport> {
  const CheckedAt = new Date().toISOString();
  const issues: Issue[] = [];
  const host = new URL(site).host;
  const concurrency = opts.Concurrency ?? 6;

  const robots = await get(new URL("/robots.txt", site).href);
  if (robots.Status !== 200 || /html/i.test(robots.ContentType)) {
    issues.push({ Kind: "robots-missing", Url: robots.Url, Detail: `robots.txt answered ${robots.Status} ${robots.ContentType}`.trim(), Evidence: ev(robots) });
  }

  const { Sitemap, Urls } = await sitemapUrls(site, get);
  if (Urls.length === 0) {
    issues.push({ Kind: "sitemap-missing", Url: Sitemap.Url, Detail: `sitemap.xml answered ${Sitemap.Status} ${Sitemap.ContentType}, with no URLs`.trim(), Evidence: ev(Sitemap) });
  }

  const pages = await pool(Urls, concurrency, get);
  const statusOf = new Map<string, Fetched>();
  const linkedFrom = new Map<string, Set<string>>();
  const titles = new Map<string, string[]>();

  for (const page of pages) {
    statusOf.set(page.Url, page);
    if (page.Status >= 300 && page.Status < 400) {
      issues.push({ Kind: "sitemap-url-redirects", Url: page.Url, Detail: `listed in the sitemap but redirects to ${page.Location ?? "?"}`, Evidence: ev(page, { Location: page.Location }) });
      continue;
    }
    if (page.Status !== 200) {
      issues.push({ Kind: "sitemap-url-error", Url: page.Url, Detail: `listed in the sitemap but answered ${page.Status}${page.Error ? ` (${page.Error})` : ""}`, Evidence: ev(page) });
      continue;
    }
    if (!/html/i.test(page.ContentType)) continue;
    const facts = readPage(page.Body, page.Url);
    if (!facts.Canonical) {
      issues.push({ Kind: "canonical-missing", Url: page.Url, Detail: "no <link rel=canonical>", Evidence: ev(page) });
    } else if (!samePage(facts.Canonical, page.Url)) {
      issues.push({ Kind: "canonical-elsewhere", Url: page.Url, Detail: `canonical points to ${facts.Canonical}`, Evidence: ev(page, { Canonical: facts.Canonical }) });
    }
    if (facts.NoIndex) issues.push({ Kind: "noindex-in-sitemap", Url: page.Url, Detail: "listed in the sitemap but marked noindex", Evidence: ev(page) });
    if (!facts.Title) issues.push({ Kind: "title-missing", Url: page.Url, Detail: "empty or missing <title>", Evidence: ev(page) });
    else titles.set(facts.Title, [...(titles.get(facts.Title) ?? []), page.Url]);
    if (facts.H1Count > 1) issues.push({ Kind: "multiple-h1", Url: page.Url, Detail: `${facts.H1Count} <h1> elements in the HTML`, Evidence: ev(page, { H1Count: facts.H1Count }) });
    for (const link of facts.Links) {
      if (new URL(link).host !== host) continue;
      if (!linkedFrom.has(link)) linkedFrom.set(link, new Set());
      linkedFrom.get(link)!.add(page.Url);
    }
  }

  for (const [title, urls] of titles) {
    if (urls.length > 1) {
      for (const url of urls) {
        const f = statusOf.get(url)!;
        issues.push({ Kind: "duplicate-title", Url: url, Detail: `"${title}" is the title of ${urls.length} sitemap pages`, Evidence: ev(f, { SharedWith: urls.filter((u) => u !== url) }) });
      }
    }
  }

  const probes = opts.ProbePaths ?? Array.from({ length: 3 }, () => `/search-health-probe-${crypto.randomUUID().slice(0, 8)}`);
  for (const f of await pool(probes.map((p) => new URL(p, site).href), concurrency, get)) {
    if (f.Status === 200) {
      const noindex = /html/i.test(f.ContentType) && readPage(f.Body, f.Url).NoIndex;
      issues.push({ Kind: "soft-200", Url: f.Url, Detail: `a URL that should not exist answered 200${noindex ? " (marked noindex)" : ""}`, Evidence: ev(f, { NoIndex: noindex }) });
    }
  }

  const unchecked = [...linkedFrom.keys()].filter((u) => !statusOf.has(u) && ![...statusOf.keys()].some((s) => samePage(s, u)));
  const toCheck = unchecked.slice(0, opts.MaxLinks ?? 500);
  for (const f of await pool(toCheck, concurrency, get)) {
    if (f.Status === 0 || f.Status >= 400) {
      const from = [...(linkedFrom.get(f.Url) ?? [])];
      issues.push({ Kind: "broken-link", Url: f.Url, Detail: `answered ${f.Status}${f.Error ? ` (${f.Error})` : ""}, linked from ${from.length} page(s)`, Evidence: ev(f, { LinkedFrom: from.slice(0, 5) }) });
    }
  }

  return { Site: site, CheckedAt, SitemapUrls: Urls, PagesFetched: pages.length, LinksChecked: toCheck.length, Issues: issues };
}
