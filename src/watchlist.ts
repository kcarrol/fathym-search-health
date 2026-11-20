/** The watch list: what the workbench pulls and scans for. A person edits it; no tool writes it. */
import { z } from "zod";
import { watchlistPath } from "./config.ts";

export const WatchlistSchema = z.object({
  /** Seed terms for keyword ideas. Each one is a Labs task. */
  Seeds: z.array(z.string()).default([]),
  /** Terms the opportunities scan looks for in our issues. Seeds are always included. */
  Terms: z.array(z.string()).default([]),
  /** Candidates containing any of these (whole words, any case) are dropped, e.g. "social engineering". */
  Exclude: z.array(z.string()).default([]),
  /** Pages we care about, by path. */
  Pages: z.array(z.string()).default([]),
  Target: z.string().default("fathym.com"),
  LocationCode: z.number().default(2840),
  LanguageCode: z.string().default("en"),
  RankedLimit: z.number().int().min(1).max(1000).default(1000),
  IdeasPerSeed: z.number().int().min(1).max(1000).default(100),
  /** Whether to call Google Ads search volume ($0.09 live). Labs volume is always there. */
  AdsVolume: z.boolean().default(true),
  /** How many candidates get Google Ads volume. */
  Candidates: z.number().int().min(1).max(1000).default(100),
  /** How many of the top candidates get a SERP read. */
  SerpTop: z.number().int().min(0).max(100).default(20),
  /** A pull whose estimate is above this stops before any paid call. */
  MaxEstimatedCost: z.number().default(1),
});
export type Watchlist = z.infer<typeof WatchlistSchema>;

export async function readWatchlist(path = watchlistPath()): Promise<Watchlist> {
  return WatchlistSchema.parse(JSON.parse(await Deno.readTextFile(path)));
}
