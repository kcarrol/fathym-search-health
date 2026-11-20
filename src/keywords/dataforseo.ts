/**
 * A thin DataForSEO client. Every call returns the endpoint, when it was called and what DataForSEO says
 * it cost, so every figure downstream carries its source. Credentials come from config and are only ever
 * put in the Authorization header.
 */
import { dataForSeoCredentials } from "../config.ts";

export const API = "https://api.dataforseo.com/v3";

export interface Called<T> {
  Endpoint: string;
  /** DataForSEO's response as it came back, so every figure can be checked against it. */
  Raw: unknown;
  CalledAt: string;
  /** What DataForSEO reported this call cost, in its account currency. */
  Cost: number;
  Result: T;
}

export type Transport = (endpoint: string, body?: unknown) => Promise<unknown>;

/** The real transport: basic auth, JSON, and DataForSEO's own status codes treated as errors. */
export function httpTransport(): Transport {
  return async (endpoint, body) => {
    const { Login, Password } = await dataForSeoCredentials();
    const res = await fetch(`${API}${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Basic ${btoa(`${Login}:${Password}`)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DataForSEO ${endpoint} answered HTTP ${res.status}`);
    return await res.json();
  };
}

interface Envelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: { status_code: number; status_message: string; cost?: number; result?: unknown[] | null }[];
}

/** Unwraps one task's result, failing loudly on any DataForSEO status that isn't 20000. */
export function unwrap(endpoint: string, raw: unknown): { Cost: number; Result: unknown[] } {
  const env = raw as Envelope;
  if (env.status_code !== 20000) throw new Error(`DataForSEO ${endpoint}: ${env.status_code} ${env.status_message}`);
  const task = env.tasks?.[0];
  if (!task) throw new Error(`DataForSEO ${endpoint}: no task in the response`);
  if (task.status_code !== 20000) throw new Error(`DataForSEO ${endpoint}: ${task.status_code} ${task.status_message}`);
  return { Cost: env.cost ?? task.cost ?? 0, Result: task.result ?? [] };
}

export class DataForSeo {
  constructor(private send: Transport = httpTransport()) {}

  private async call<T>(endpoint: string, body: unknown, read: (result: unknown[]) => T): Promise<Called<T>> {
    const CalledAt = new Date().toISOString();
    const Raw = await this.send(endpoint, body);
    const { Cost, Result } = unwrap(endpoint, Raw);
    return { Endpoint: endpoint, CalledAt, Cost, Raw, Result: read(Result) };
  }

  /**
   * Account balance. Free. user_data also carries the account's login and settings, so only the balance
   * is kept: the raw response is replaced by it before anything stores or returns it.
   */
  async balance(): Promise<Called<{ Balance: number | null; Currency: string | null }>> {
    const c = await this.call("/appendix/user_data", undefined, (r) => {
      const money = (r[0] as { money?: { balance?: number; currency?: string } } | undefined)?.money;
      return { Balance: money?.balance ?? null, Currency: money?.currency ?? null };
    });
    return { ...c, Raw: { redacted: "user_data: only the balance is kept", ...c.Result } };
  }

  /** What `target` ranks for in Google (Labs). */
  rankedKeywords(target: string, loc: Locale, limit: number) {
    return this.call("/dataforseo_labs/google/ranked_keywords/live", [{ target, ...loc, limit }], (r) => {
      const items = ((r[0] as { items?: RankedItem[] } | undefined)?.items ?? []);
      return items.map((i) => ({
        Keyword: i.keyword_data?.keyword ?? "",
        Volume: i.keyword_data?.keyword_info?.search_volume ?? null,
        Difficulty: i.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
        Rank: i.ranked_serp_element?.serp_item?.rank_absolute ?? null,
        Url: i.ranked_serp_element?.serp_item?.url ?? null,
      })).filter((k) => k.Keyword);
    });
  }

  /**
   * Searches that contain the seed phrase (Labs keyword_suggestions). keyword_ideas was tried first and
   * dropped: it works by category, so "context engineering" returned "civil engineering" (6.2, 2026-11-20).
   */
  keywordSuggestions(seed: string, loc: Locale, limit: number) {
    return this.call("/dataforseo_labs/google/keyword_suggestions/live", [{ keyword: seed, ...loc, limit }], (r) => {
      const items = ((r[0] as { items?: IdeaItem[] } | undefined)?.items ?? []);
      return items.map((i) => ({
        Keyword: i.keyword ?? "",
        Volume: i.keyword_info?.search_volume ?? null,
        Difficulty: i.keyword_properties?.keyword_difficulty ?? null,
        Intent: i.search_intent_info?.main_intent ?? null,
      })).filter((k) => k.Keyword);
    });
  }

  /** Google Ads monthly search volume, live. Up to 1,000 keywords in one task. */
  searchVolume(keywords: string[], loc: Locale) {
    return this.call("/keywords_data/google_ads/search_volume/live", [{ keywords, ...loc }], (r) =>
      (r as { keyword?: string; search_volume?: number | null }[]).map((i) => ({
        Keyword: i.keyword ?? "",
        Volume: i.search_volume ?? null,
      })));
  }

  /** One Google results page, live, with the AI Overview block when there is one. */
  serp(keyword: string, loc: Locale) {
    return this.call("/serp/google/organic/live/advanced", [{ keyword, ...loc, depth: 10, load_async_ai_overview: true }], (r) => {
      const items = ((r[0] as { items?: SerpItem[] } | undefined)?.items ?? []);
      const organic = items.filter((i) => i.type === "organic");
      const overview = items.find((i) => i.type === "ai_overview");
      return {
        AiOverview: !!overview,
        AiOverviewCitesFathym: !!overview && JSON.stringify(overview).includes("fathym.com"),
        Top: organic.slice(0, 10).map((i) => ({ Rank: i.rank_absolute ?? null, Domain: resultDomain(i), Url: i.url ?? "" })),
      };
    });
  }
}

/**
 * The site a result belongs to. Google now wraps result links in `google.com/goto?url=…`, and DataForSEO
 * reports `domain: google.com` for them (seen 2026-11-20), so the breadcrumb's host, else the website name,
 * is the real one.
 */
export function resultDomain(i: SerpItem): string {
  if (i.domain && i.domain !== "google.com") return i.domain;
  const crumb = i.breadcrumb?.match(/^https?:\/\/([^\s/›]+)/)?.[1];
  return (crumb ?? i.website_name ?? i.domain ?? "").replace(/^www\./, "");
}

export interface Locale {
  location_code: number;
  language_code: string;
}

interface RankedItem {
  keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number }; keyword_properties?: { keyword_difficulty?: number } };
  ranked_serp_element?: { serp_item?: { rank_absolute?: number; url?: string } };
}
interface IdeaItem {
  keyword?: string;
  keyword_info?: { search_volume?: number };
  keyword_properties?: { keyword_difficulty?: number };
  search_intent_info?: { main_intent?: string };
}
export interface SerpItem {
  type?: string;
  breadcrumb?: string;
  website_name?: string;
  rank_absolute?: number;
  domain?: string;
  url?: string;
}
