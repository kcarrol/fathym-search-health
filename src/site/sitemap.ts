/** The sitemap's URLs (following a sitemap index one level down) and robots.txt. */

export function readLocs(xml: string): { Index: boolean; Locs: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  return { Index: /<sitemapindex\b/i.test(xml), Locs: locs };
}

export interface Fetched {
  Url: string;
  Status: number;
  ContentType: string;
  Body: string;
  Location?: string;
  FetchedAt: string;
  Error?: string;
}

export type Fetcher = (url: string) => Promise<Fetched>;

/** One GET, no redirects followed, with a timeout. A network failure is a Fetched with Status 0. */
export function httpFetcher(timeoutMs = 15_000, userAgent = "search-health (fathym.com site check)"): Fetcher {
  return async (url) => {
    const FetchedAt = new Date().toISOString();
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ContentType = res.headers.get("content-type") ?? "";
      const Body = /html|xml|text/i.test(ContentType) ? await res.text() : (await res.body?.cancel(), "");
      return { Url: url, Status: res.status, ContentType, Body, Location: res.headers.get("location") ?? undefined, FetchedAt };
    } catch (e) {
      return { Url: url, Status: 0, ContentType: "", Body: "", FetchedAt, Error: (e as Error).message };
    }
  };
}

export async function sitemapUrls(site: string, get: Fetcher): Promise<{ Sitemap: Fetched; Urls: string[] }> {
  const Sitemap = await get(new URL("/sitemap.xml", site).href);
  if (Sitemap.Status !== 200 || !/xml/i.test(Sitemap.ContentType)) return { Sitemap, Urls: [] };
  const top = readLocs(Sitemap.Body);
  if (!top.Index) return { Sitemap, Urls: top.Locs };
  const urls: string[] = [];
  for (const child of top.Locs) {
    const f = await get(child);
    if (f.Status === 200) urls.push(...readLocs(f.Body).Locs);
  }
  return { Sitemap, Urls: urls };
}
