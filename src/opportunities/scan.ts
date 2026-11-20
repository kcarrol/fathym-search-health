/**
 * Opportunities.Scan: what changed in our own work that might change what we watch. Gathers the issues
 * updated since the last scan in three repos, with the watch list beside them. It judges nothing: the
 * calling AI reads it with the "opportunity review" prompt, and a person changes watchlist.json.
 */

export const REPOS = ["fathym-deno/fathym-dev-space", "fathym-deno/fathym-web-runtime", "fathym-deno/fathym-research"];

export type GitHubGet = (path: string) => Promise<unknown>;

export function httpGitHub(token: () => Promise<string>): GitHubGet {
  return async (path) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${await token()}`, Accept: "application/vnd.github+json", "User-Agent": "search-health" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub ${path.split("?")[0]} answered ${res.status}`);
    return await res.json();
  };
}

interface GhIssue {
  number: number; title: string; html_url: string; state: string; updated_at: string; body?: string | null;
  labels?: { name: string }[]; pull_request?: unknown;
}

export interface ScannedIssue {
  Repo: string; Number: number; Title: string; Url: string; State: string; UpdatedAt: string;
  Labels: string[]; Excerpt: string;
  /** Watch-list terms this issue mentions (case-insensitive whole words, in its title or body). */
  Mentions: string[];
}

export interface OpportunitiesResult {
  ScannedAt: string;
  Since: string;
  Repos: string[];
  Terms: string[];
  Issues: ScannedIssue[];
  Source: string;
}

const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive: "fAI" matches "fai run" but not "failed". */
export function mentions(text: string, terms: string[]): string[] {
  return terms.filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(t)}($|[^\\p{L}\\p{N}])`, "iu").test(text));
}

export async function scanOpportunities(get: GitHubGet, terms: string[], since: string, repos = REPOS, maxPages = 3): Promise<OpportunitiesResult> {
  const ScannedAt = new Date().toISOString();
  const lower = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  const issues: ScannedIssue[] = [];
  for (const repo of repos) {
    for (let page = 1; page <= maxPages; page++) {
      const batch = await get(`/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}&since=${encodeURIComponent(since)}`) as GhIssue[];
      for (const i of batch) {
        if (i.pull_request) continue;
        const text = `${i.title}\n${i.body ?? ""}`;
        issues.push({
          Repo: repo, Number: i.number, Title: i.title, Url: i.html_url, State: i.state, UpdatedAt: i.updated_at,
          Labels: (i.labels ?? []).map((l) => l.name), Excerpt: (i.body ?? "").replace(/\s+/g, " ").slice(0, 500),
          Mentions: mentions(text, lower),
        });
      }
      if (batch.length < 100) break;
    }
  }
  issues.sort((a, b) => b.Mentions.length - a.Mentions.length || b.UpdatedAt.localeCompare(a.UpdatedAt));
  return { ScannedAt, Since: since, Repos: repos, Terms: lower, Issues: issues, Source: "GitHub REST GET /repos/{repo}/issues?since=" };
}
