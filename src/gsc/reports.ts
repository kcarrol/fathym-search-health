/**
 * The six Search Console reports (6.3, `DESIGN.md` "What Search Console answers"), taken as ideas from Onsite.
 * Pure functions over kept pulls: nothing here calls Google, and every report carries the call and range it
 * came from. The API returns top rows only, so every sum is a sum of top rows.
 */
import type { GscResult } from "./pull.ts";
import type { Watchlist } from "../watchlist.ts";
import { mentions } from "../opportunities/scan.ts";

type Settings = Pick<Watchlist, "Brand" | "StrikingDistance" | "LowCtrRatio">;
type Row = { Clicks: number; Impressions: number; Ctr: number; Position: number };

/** Queries just off the top results with real impressions: the cheapest wins. */
export function strikingDistance(cur: GscResult, s: Settings) {
  const { MinPosition, MaxPosition, MinImpressions } = s.StrikingDistance;
  return {
    Source: cur.Sources.Queries,
    Band: { MinPosition, MaxPosition, MinImpressions },
    Queries: cur.Queries
      .filter((q) => q.Position >= MinPosition && q.Position <= MaxPosition && q.Impressions >= MinImpressions)
      .sort((a, b) => b.Impressions - a.Impressions),
  };
}

type Drop<K extends string> = Record<K, string> & { Clicks: { Now: number; Was: number }; Impressions: { Now: number; Was: number } };

function drops<K extends string>(key: K, now: (Row & Record<K, string>)[], before: (Row & Record<K, string>)[]): Drop<K>[] {
  const was = new Map(before.map((r) => [r[key], r]));
  return now.flatMap((r) => {
    const p = was.get(r[key]);
    if (!p || (r.Clicks >= p.Clicks && r.Impressions >= p.Impressions)) return [];
    return [{ [key]: r[key], Clicks: { Now: r.Clicks, Was: p.Clicks }, Impressions: { Now: r.Impressions, Was: p.Impressions } } as Drop<K>];
  }).sort((a, b) => (a.Clicks.Now - a.Clicks.Was) - (b.Clicks.Now - b.Clicks.Was) || (a.Impressions.Now - a.Impressions.Was) - (b.Impressions.Now - b.Impressions.Was));
}

/** URLs in the latest site check's sitemap, if there is one; a page outside it has moved or been removed. */
export type Sitemap = Set<string> | undefined;
const inSitemap = (sitemap: Sitemap, page: string) => !sitemap || sitemap.has(page);

/**
 * What lost clicks or impressions: against the previous period in the same pull, and against the last kept
 * pull. Only rows present in both are compared; a row that fell out of the top rows entirely is not seen.
 * Pages not in the sitemap are listed apart as `MovedOrRemoved`: their loss is usually their new URL's gain.
 */
export function falling(cur: GscResult, last?: GscResult, sitemap?: Sitemap) {
  const split = (rows: Drop<"Page">[]) => ({
    Pages: rows.filter((r) => inSitemap(sitemap, r.Page)),
    MovedOrRemoved: rows.filter((r) => !inSitemap(sitemap, r.Page)),
  });
  return {
    VsPreviousPeriod: cur.Previous
      ? {
        Range: cur.Range, PreviousRange: cur.Previous.Range, Source: cur.Sources.Previous,
        ...split(drops("Page", cur.Pages, cur.Previous.Pages)), Queries: drops("Query", cur.Queries, cur.Previous.Queries),
      }
      : null,
    VsLastPull: last
      ? { Range: cur.Range, LastPullRange: last.Range, ...split(drops("Page", cur.Pages, last.Pages)), Queries: drops("Query", cur.Queries, last.Queries) }
      : null,
    SitemapKnown: Boolean(sitemap),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Pages that rank but don't get clicked: CTR under `LowCtrRatio` x the site's own median CTR among pages at the
 * same rounded position. A position shared by fewer than 3 pages has no median and is skipped.
 */
export function lowCtr(cur: GscResult, s: Settings) {
  const min = s.StrikingDistance.MinImpressions;
  const pages = cur.Pages.filter((p) => p.Impressions >= min);
  const byPos = new Map<number, typeof pages>();
  for (const p of pages) byPos.set(Math.round(p.Position), [...(byPos.get(Math.round(p.Position)) ?? []), p]);
  const flagged = [];
  for (const [pos, group] of byPos) {
    if (group.length < 3) continue;
    const med = median(group.map((g) => g.Ctr));
    for (const p of group) if (p.Ctr < s.LowCtrRatio * med) flagged.push({ ...p, RoundedPosition: pos, SiteMedianCtr: med, PagesAtPosition: group.length });
  }
  return {
    Source: cur.Sources.Pages, Ratio: s.LowCtrRatio, MinImpressions: min,
    Pages: flagged.sort((a, b) => b.Impressions - a.Impressions),
  };
}

/**
 * A query where two or more of our pages in the sitemap get impressions, so they compete. Needs the query+page
 * call. Brand and `site:` queries are left out (many of our pages showing for "fathym" is expected), and a query
 * whose extra pages are all outside the sitemap is a move (an old URL beside its new one), listed apart.
 */
export function cannibalisation(cur: GscResult, s: Settings, sitemap?: Sitemap) {
  if (!cur.QueryPages) return { Source: null, Queries: [], Moved: [], Excluded: 0, Note: "This pull has no query+page rows (pulled before 6.3)." };
  const by = new Map<string, NonNullable<GscResult["QueryPages"]>>();
  let excluded = 0;
  for (const r of cur.QueryPages) {
    if (r.Impressions <= 0) continue;
    if (/^site:/i.test(r.Query.trim()) || mentions(r.Query, s.Brand).length) {
      excluded++;
      continue;
    }
    by.set(r.Query, [...(by.get(r.Query) ?? []), r]);
  }
  const total = (pages: { Impressions: number }[]) => pages.reduce((n, p) => n + p.Impressions, 0);
  const groups = [...by].filter(([, rows]) => rows.length >= 2).map(([Query, rows]) => ({
    Query,
    Pages: rows.sort((a, b) => b.Impressions - a.Impressions).map(({ Page, Clicks, Impressions, Position }) => ({ Page, Clicks, Impressions, Position, InSitemap: inSitemap(sitemap, Page) })),
  })).sort((a, b) => total(b.Pages) - total(a.Pages));
  return {
    Source: cur.Sources.QueryPages,
    Queries: groups.filter((g) => g.Pages.filter((p) => p.InSitemap).length >= 2),
    Moved: groups.filter((g) => g.Pages.filter((p) => p.InSitemap).length < 2),
    Excluded: excluded,
    Note: `Brand and site: queries left out (${excluded} rows). "Moved" are queries whose other pages are not in the sitemap: an old URL beside its new one.`,
  };
}

/** Demand for Fathym by name against everything else, from the query rows (whole-word Brand terms). */
export function brandSplit(cur: GscResult, s: Settings) {
  const side = { Clicks: 0, Impressions: 0, Queries: 0 };
  const branded = { ...side }, other = { ...side };
  for (const q of cur.Queries) {
    const t = mentions(q.Query, s.Brand).length ? branded : other;
    t.Clicks += q.Clicks;
    t.Impressions += q.Impressions;
    t.Queries++;
  }
  return { Source: cur.Sources.Queries, Range: cur.Range, Brand: s.Brand, Branded: branded, NonBranded: other, Note: "Sums of the top query rows the API returned, not every query." };
}

/** URLs whose URL Inspection verdict changed since they were last inspected, across kept pulls (newest first). */
export function indexingHistory(pulls: GscResult[]) {
  const seen = new Map<string, { Verdict?: string; Coverage?: string; PulledAt: string }[]>();
  for (const p of pulls) {
    for (const i of p.Inspected) seen.set(i.Url, [...(seen.get(i.Url) ?? []), { Verdict: i.Verdict, Coverage: i.Coverage, PulledAt: p.PulledAt }]);
  }
  const changes = [...seen].flatMap(([Url, [now, before]]) =>
    before && now.Verdict !== before.Verdict ? [{ Url, Now: now, Before: before }] : []
  );
  return { Source: "urlInspection.index.inspect, across kept pulls", PullsRead: pulls.length, Changes: changes };
}

/**
 * All six, for `report-current`. `pulls` is newest first; `pulls[0]` is the current one. `sitemapUrls` is the
 * latest site check's sitemap, which separates moved or removed pages from real losses and conflicts.
 */
export function searchConsoleReports(pulls: GscResult[], s: Settings, sitemapUrls?: string[]) {
  const [cur, last] = pulls;
  const sitemap = sitemapUrls ? new Set(sitemapUrls) : undefined;
  return {
    StrikingDistance: strikingDistance(cur, s),
    Falling: falling(cur, last, sitemap),
    LowCtr: lowCtr(cur, s),
    Cannibalisation: cannibalisation(cur, s, sitemap),
    BrandSplit: brandSplit(cur, s),
    IndexingHistory: indexingHistory(pulls),
  };
}
