/**
 * Keywords.Pull: what fathym.com ranks for, and what to write next. Prices are DataForSEO's published
 * ones (DESIGN.md, fetched 2026-11-20) and only gate the run; the cost recorded is what DataForSEO reports.
 */
import type { Watchlist } from "../watchlist.ts";
import type { DataForSeo } from "./dataforseo.ts";
import { mentions } from "../opportunities/scan.ts";

/** Published prices, live queue: https://dataforseo.com/pricing (fetched 2026-11-20). */
export const PRICES = { LabsTask: 0.012, LabsItem: 0.00012, AdsLiveTask: 0.09, SerpLive: 0.002, AiOverviewFactor: 2 };

export function estimateCost(w: Watchlist): number {
  const labs = (tasks: number, items: number) => tasks * PRICES.LabsTask + items * PRICES.LabsItem;
  return labs(1, w.RankedLimit) + labs(w.Seeds.length, w.Seeds.length * w.IdeasPerSeed) + (w.AdsVolume ? PRICES.AdsLiveTask : 0) +
    w.SerpTop * PRICES.SerpLive * PRICES.AiOverviewFactor;
}

export interface Candidate {
  Keyword: string;
  Seed: string;
  LabsVolume: number | null;
  AdsVolume: number | null;
  Difficulty: number | null;
  Intent: string | null;
  /** Where fathym.com ranks for it today, from ranked_keywords; null when it doesn't. */
  FathymRank: number | null;
  FathymUrl: string | null;
  Serp?: { AiOverview: boolean; AiOverviewCitesFathym: boolean; TopDomains: string[] };
}

export interface KeywordsResult {
  PulledAt: string;
  Balance: { Before: number | null; Currency: string | null };
  EstimatedCost: number;
  /** The sum of what DataForSEO reported for each call. */
  Cost: number;
  Calls: { Endpoint: string; CalledAt: string; Cost: number; Raw: unknown }[];
  Ranked: { Keyword: string; Volume: number | null; Difficulty: number | null; Rank: number | null; Url: string | null }[];
  Candidates: Candidate[];
  Sources: Record<string, string>;
  /** The watch-list settings this pull ran with, so a reader knows its limits. */
  Settings: Pick<Watchlist, "Seeds" | "Exclude" | "RankedLimit" | "IdeasPerSeed" | "AdsVolume" | "Candidates" | "SerpTop">;
}

export async function pullKeywords(w: Watchlist, api: DataForSeo): Promise<KeywordsResult> {
  if (w.Seeds.length === 0) throw new Error("The watch list has no Seeds: add some to watchlist.json first.");
  const est = estimateCost(w);
  if (est > w.MaxEstimatedCost) {
    throw new Error(`Estimated cost $${est.toFixed(3)} is above MaxEstimatedCost $${w.MaxEstimatedCost}: nothing was called.`);
  }
  const loc = { location_code: w.LocationCode, language_code: w.LanguageCode };
  const calls: KeywordsResult["Calls"] = [];
  const log = <T>(c: { Endpoint: string; CalledAt: string; Cost: number; Raw: unknown; Result: T }) => {
    calls.push({ Endpoint: c.Endpoint, CalledAt: c.CalledAt, Cost: c.Cost, Raw: c.Raw });
    return c.Result;
  };

  const balance = await api.balance();
  calls.push({ Endpoint: balance.Endpoint, CalledAt: balance.CalledAt, Cost: balance.Cost, Raw: balance.Raw });
  const ranked = log(await api.rankedKeywords(w.Target, loc, w.RankedLimit));
  const rankOf = new Map(ranked.map((r) => [r.Keyword.toLowerCase(), r]));

  const ideas = new Map<string, Candidate>();
  for (const seed of w.Seeds) {
    for (const i of log(await api.keywordSuggestions(seed, loc, w.IdeasPerSeed))) {
      const key = i.Keyword.toLowerCase();
      if (ideas.has(key) || mentions(i.Keyword, w.Exclude).length) continue;
      const r = rankOf.get(key);
      ideas.set(key, {
        Keyword: i.Keyword, Seed: seed, LabsVolume: i.Volume, AdsVolume: null, Difficulty: i.Difficulty, Intent: i.Intent,
        FathymRank: r?.Rank ?? null, FathymUrl: r?.Url ?? null,
      });
    }
  }

  const candidates = [...ideas.values()].sort((a, b) => (b.LabsVolume ?? -1) - (a.LabsVolume ?? -1)).slice(0, w.Candidates);
  if (candidates.length && w.AdsVolume) {
    const vol = new Map(log(await api.searchVolume(candidates.map((c) => c.Keyword), loc)).map((v) => [v.Keyword.toLowerCase(), v.Volume]));
    for (const c of candidates) c.AdsVolume = vol.get(c.Keyword.toLowerCase()) ?? null;
  }
  for (const c of candidates.slice(0, w.SerpTop)) {
    const s = log(await api.serp(c.Keyword, loc));
    c.Serp = { AiOverview: s.AiOverview, AiOverviewCitesFathym: s.AiOverviewCitesFathym, TopDomains: s.Top.map((t) => t.Domain) };
  }

  return {
    PulledAt: balance.CalledAt,
    Balance: { Before: balance.Result.Balance, Currency: balance.Result.Currency },
    EstimatedCost: Number(est.toFixed(4)),
    Cost: Number(calls.reduce((s, c) => s + c.Cost, 0).toFixed(6)),
    Calls: calls,
    Ranked: ranked,
    Candidates: candidates,
    Settings: { Seeds: w.Seeds, Exclude: w.Exclude, RankedLimit: w.RankedLimit, IdeasPerSeed: w.IdeasPerSeed, AdsVolume: w.AdsVolume, Candidates: w.Candidates, SerpTop: w.SerpTop },
    Sources: {
      Ranked: "dataforseo_labs/google/ranked_keywords/live",
      LabsVolume: "dataforseo_labs/google/keyword_suggestions/live (keyword_info.search_volume)",
      AdsVolume: "keywords_data/google_ads/search_volume/live",
      Serp: "serp/google/organic/live/advanced (load_async_ai_overview)",
    },
  };
}
