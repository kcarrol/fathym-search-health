# Design

**Status:** accepted by Kilian, 2026-11-20 (6.1.4). Nothing is built yet; 6.2 builds it. Each choice below cites rows in
[`FEATURE-LOG.md`](FEATURE-LOG.md) (`#n`).

## The question it answers

From [`PROBLEM.md`](PROBLEM.md): **"Is the site healthy, and what should we write next?"**, with **what changed
since last time**, giving the same current answer to any of us and any AI.

That breaks into three answers:

- **Health.** For every URL in fathym.com's sitemap, plus a set of URLs that should not exist:
  - the status code, and whether an unknown URL wrongly answers 200 (soft-200)
  - the canonical, and whether it is missing or points elsewhere
  - `noindex` on a page the sitemap lists
  - sitemap and robots.txt present, and the sitemap's drift from the last run
  - broken internal links
  - duplicate titles
  - more than one H1

  Each issue is listed with its URL. Compared with the last run, it says what is new, what is fixed and what is
  unchanged. These are the gaps already on record in dev-space#143 comment 6523748041 (#45).
- **Write next.**
  - What fathym.com already ranks for (#42 `ranked_keywords`).
  - Candidate topics from seed terms (#42 `keyword_suggestions`, searches containing the seed; `keyword_ideas` was tried and dropped in 6.2 because it works by category: "context engineering" returned "civil engineering"), each with search volume (#41).
  - Whether an AI Overview shows for the top candidates (#43).
  - Whether a page on the site already covers each candidate.

  The answer is a short ranked list. Compared with the last run, it says new candidates, dropped ones and rank
  changes. It does not replace Track 1's keyword research: it is a standing readout that writers and Track 1
  can read (D-6.2).

- **Opportunities.** What changed in our own work that should change what we watch. Issues opened or
  updated since the last scan in `fathym-deno/fathym-dev-space`, `fathym-deno/fathym-web-runtime` and
  `fathym-deno/fathym-research` (a new page, a renamed product, a launch, a thought heading somewhere new) are
  set beside the current watch list of keywords and pages. The answer is a short list of proposed changes,
  each with the issue it came from: watch this term, stop watching that one, this page now targets that
  search. A person accepts a change to the watch list; nothing changes it on its own (#49).

## What gets built

**One workbench, `search-health`, with three modes: MCP, API and Web.** #1–#4

| Tool (method) | Does | Paid? |
| --- | --- | --- |
| `Site.Check` | Runs the health checks against the live site and keeps the result as a snapshot | No |
| `Keywords.Pull` | Runs the DataForSEO calls below and keeps the result as a snapshot | Yes |
| `Opportunities.Scan` | Collects the issues changed since the last scan in the three repos, with the watch list beside them, and keeps them as a snapshot. The calling AI judges which are opportunities (the "opportunity review" prompt); the workbench gathers, it does not run a model of its own | No |
| `SearchConsole.Pull` | Reads fathym.com's Search Console through Google's API and keeps it as a snapshot: queries and pages with clicks, impressions, CTR and position (Search Analytics); index status, Google's chosen canonical and last crawl for a rotating set of sitemap URLs (URL Inspection); when Google last read the sitemap and its errors (Sitemaps). See Search Console below | No price stated by Google |
| `Report.Current` | The latest health, write-next and opportunity answers, with the change since the previous snapshot | No |
| `Report.History` | Past snapshots, by date | No |
| `Report.Export` | Writes the latest results into dev-space folders (see Where its data lives). Local runs only | No |

- **MCP** (#2): any AI asks the question; `fai mcp install` connects coding agents in one step (#40); Thinky may
  use it (#31).
- **API** (#3): what scripts and an API Source call (`POST /site/check`, `POST /keywords/pull`).
- **Web** (#4): one page for a person: health issues, the write-next list, what changed, and when each was last
  run. `GET /health` is reserved by the mode.
- **Two prompts** (#8): "weekly site review", so every AI reads the report the same way, and "opportunity
  review", which tells the AI how to read `Opportunities.Scan` against the watch list and what to propose.

**Why one workbench, not several.** All three answers serve one question and keep one history. The game-night
split (game server and front end as separate workbenches, joined with Consumes, #11) fits when the parts
have different users or lifecycles. Here they share both. The split is recorded below as an alternative. Kilian, 2026-11-20: start with one; split it, or add
complementary workbenches beside it, later if that suits better.

**Why not tools over MCP alone.** PROBLEM.md names people as well as AIs, and scripts call it too. The Web
mode serves the first, and the API mode gives the second something to call.

## Where its data lives between runs

**Locally (6.2): a fai vault** (#7). The workbench declares one vault with git-backed storage, and each run's
snapshot is a kept entry, so "what changed" compares the newest two. This is the platform's own mechanism,
and the analytics workbench uses it the same way.

**Key results also land in dev-space** (Kilian, 2026-11-20), where the team's other work already reads them.
`Report.Export`, run locally, writes a dated folder in the same shape as the existing demand reads
(`research/fathym-marketing/demand/2026-11-05-tasm-first-pass/`, with `raw/dataforseo/` beside a summary):

- keyword pulls → `research/fathym-marketing/demand/<date>-search-health/` (summary + `raw/dataforseo/`)
- site health and opportunities → `research/fathym-marketing/site-health/<date>/` (new folder)

The vault stays the workbench's own memory; the export is the copy people read and cite. It is committed
like any other dev-space change, by a person. A hosted workbench cannot write to dev-space, so exports are
local runs.

**Hosted (6.3): a seam, decided by what the workspace has.** A hosted workbench's vault "doesn't survive a
redeploy yet" (#7), so hosted snapshots need somewhere durable:

1. **If the workspace has a connected cloud and a private landing zone:** a Cosmos container in the
   workspace (#17), written through its table endpoints with a key held as an Environment value (#10, #19).
   A warm query over it (#16) then gives `call_api` the same answer (#34). History then lives in the
   platform's own durable store.
2. **If it does not:** snapshots are committed to a `snapshots` branch of this repo. That works anywhere,
   and git keeps the history.

6.3 starts with `get_workspace` (`Capabilities.InactiveKinds`, #33) and picks option 1 or 2 from the
answer. The tools write through one small storage interface, so the choice touches one file.

## What runs on its own, and how often

**Nothing, for now. Runs are on demand** (Kilian, 2026-11-20, D-6.6): from an AI over MCP, from the API, or
from the page. A GitHub Actions schedule (#46) is added only if a need for one appears. fai has no
scheduler (#40), and "a scheduled job is not a mode" (#5).

| Job | Run when | Why |
| --- | --- | --- |
| `Site.Check` | After a site batch ships, or when asked | Free; a batch is when something breaks |
| `Keywords.Pull` | When asked, typically weekly | Paid; search data moves slowly |
| `Opportunities.Scan` | Before a keyword pull, or when asked | Free; feeds the watch list the pull uses |
| `SearchConsole.Pull` | When asked, typically weekly | Google's data lags 2–3 days, so more often adds little |

**Search Console, through its API** (#52). Kilian, 2026-11-20: built in this workbench. It is an SEO
capability, so it suits this workbench, and the phase content-operations routed it to in
team-workbenches `track-6-analytics-funnel` was never written, with no sign it will be soon. This
overrides D-6.2's "the probe takes over neither ... Search Console" (a new ledger entry at closure). If it
works, lifting it into a shared place later is a small move, and where a capability like this should live
is a question for 6.4.

What Google's docs state (read 2026-11-20):
- **Search Analytics:** `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`,
  dimensions including `query`, `page`, `country`, `device`, `date`; metrics clicks, impressions, ctr,
  position; up to 25,000 rows a request; "Data is typically available after 2-3 days"; the API returns
  "top ones", not every row. (https://developers.google.com/webmaster-tools/v1/searchanalytics/query, https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data)
- **URL Inspection:** `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`, returning
  verdict, coverage state, robots state, indexing state (incl. `BLOCKED_BY_META_TAG`), page fetch state
  (incl. `SOFT_404`), last crawl time, Google's canonical and ours. Quota per site: "2000 QPD" and "600 QPM",
  so the roughly 290 sitemap URLs fit in one day; inspecting all of them weekly is within quota.
  (https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect, https://developers.google.com/webmaster-tools/limits)
- **Sitemaps:** last submitted, last downloaded, errors and warnings per sitemap. (https://developers.google.com/webmaster-tools/v1/sitemaps)
- **Access:** OAuth 2.0 only ("No other authorization protocols are supported"), read-only scope
  `https://www.googleapis.com/auth/webmasters.readonly`. (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing)
- **Cost:** none of these pages states a price.

⚠️ **Not confirmed by those pages: whether a service account works.** The GA4 route uses one; Google's
Search Console pages read say only that requests "must be authorized by an authenticated user". 6.2 tries
a service account added as a user on the fathym.com property first; if that fails, Kilian authorizes once
and the workbench keeps a refresh token as a secret. Either way the scope is read-only.

URL Inspection is the health half's second opinion: `Site.Check` sees what the site serves, Inspection sees
what Google made of it (indexed or not, which canonical it chose, a soft-404 it recorded).

**Google Analytics** already has an API route in the analytics workbench (`GoogleAnalyticsCapability`, GA4
Data API, #50). If this workbench needs it, it reads it from there (Consumes, #11), not from a browser.

**Triggers for workbenches are a gap worth naming** (Kilian, 2026-11-20). Nothing in fai or the OpenX docs
schedules a workbench or runs it after an event, and the analytics workbench has no triggers either: it
snapshots when called (#47). The one event-shaped thing is a custom webhook mode (#5), which runs when
something calls it. Scheduling and triggers would serve many workbenches, so it goes to @mcgear as a
question in 6.4, not built here.

**In 6.3, an OpenX API Source is tried once** (#14 polling `POST /site/check`), as a feature exploration:
it is the platform's only way to run something on an interval. The result goes in the log either way:
used, or tried and dropped with what stopped it.

## Who and what calls it

| Caller | Through | How it is let in |
| --- | --- | --- |
| Kilian and anyone writing for the site | Web | Sign-in (#12) |
| Claude Code, Codex and any coding agent | MCP, via `fai mcp install` | Bearer token (#12) |
| Thinky in the workspace | MCP, endpoint switched on (#31) | The workspace |

**Sign-in.** With App Identity (it needs the landing zone), the modes are set to **Identity** and check tokens
the way the sign-in guide shows (#12, #25's `CallerCheck`). Without it, the modes are set to **None**, and
the workbench checks a bearer token itself against one held in its Environment values (#10). It fails closed
when that value is unset. Either way, DataForSEO calls cannot be triggered by anyone who has only the
address.

## What a run costs

DataForSEO prices fetched 2026-11-20. The pages show "$" with no currency code. Site checks cost nothing.

| Call | Per `Keywords.Pull` | Price, source |
| --- | --- | --- |
| Labs `ranked_keywords` for fathym.com, up to 1,000 items | 1 task, ≤ 1,000 items: ≤ $0.132 | $0.012/task + $0.00012/item, https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api |
| Labs `keyword_suggestions` (searches containing the seed) for 5 seed terms, 100 items each | 5 tasks, 500 items: $0.12 | same page |
| Google Ads `search_volume`, **live**, ≤ 1,000 keywords | 1 task: $0.09 | $0.09/task live ($0.06 standard), https://dataforseo.com/pricing/keywords-data/google-ads |
| SERP Google Organic, **live**, with AI Overview, top 20 candidates | 20 SERPs × $0.004: $0.08 | $0.002/SERP live, AI Overview "Total = 2x base price", https://dataforseo.com/pricing/google-serp/google-organic-serp-api |
| **Total per run** | **≤ about $0.42** | |

**Why live, not the standard queue** (6.2, 2026-11-20): runs are on demand (D-6.6), and the standard queue
answers in 1–3 hours for Google Ads and about 5 minutes on average for SERP. Live answers within the call.
It costs about $0.08 more per run than the queued prices.

Every run records the `cost` DataForSEO returns in its responses, which is the real figure; the table is the
estimate. The minimum top-up is $50 (https://dataforseo.com/pricing). The seed count and item limits are the
cost levers, and they live in `watchlist.json`, not code.

## Changes from the first real use (6.2.8, Kilian, 2026-11-20)

- **Negative terms.** `watchlist.json` has an `Exclude` list; a candidate containing an excluded term is
  dropped. It starts with "social engineering", which the "context engineering" seed pulled in.
- **Search intent in every recommendation.** The prompts make the AI state each term's search intent
  (the pull's Intent field) and whether those searchers are who we want. A generic word that is also our
  product name ("Workshops") has the wrong intent; the branded form ("Fathym Workshops") is the term.
- **Next, after a top-up:** a paid intent check for terms the AI proposes that no pull has covered
  (DataForSEO Labs `search_intent`, priced on the same Labs page as the other Labs calls).

## What Search Console answers (6.3, Kilian, 2026-11-24)

Search Console is where "what should we write next" gets its strongest answer: searches people already
make that find us, rather than estimates. Six reports, taken as ideas from Onsite (onsite.so, #60), prior
art for our own stack. Each is computed from the kept pulls, never by the AI, and carries the call and
date range it came from.

| Report | Reads | Answers |
| --- | --- | --- |
| Striking distance | queries, this period | Searches where we sit just off the top results (the watch list's band, positions 4–20 as in Onsite's report) with at least the watch list's minimum impressions: the cheapest wins |
| Falling | queries and pages, this period and the previous one of the same length (one pull); and the last kept pull | What is losing clicks or impressions, so we refresh it before it goes |
| Low CTR for the position | pages, this period | Pages that rank but don't get clicked: CTR under the watch list's `LowCtrRatio` times **the site's own** median CTR at the same rounded position (only where 3 or more pages share it). ⛔ No industry CTR curve: it would be a number without a source |
| Cannibalisation | `[query, page]` together, this period | A query where two or more of our pages get impressions, so they compete |
| Branded split | queries, this period | Clicks and impressions for queries containing a `Brand` term (whole words), against the rest: how much demand is for Fathym by name (D-6.8) |
| Indexing history | URL Inspection across kept pulls | URLs whose verdict changed (PASS to anything else, or back) since they were last inspected |

**Pull changes.** `SearchConsole.Pull` adds a `[query, page]` call and the previous period of the same length
(queries, pages), so the first pull already shows decay. Change from run to run still comes from the vault.

**Watch-list changes.** A person edits these, as before:

- `Brand`: `["fathym", "fathym workshops", "fai"]`, branded forms only (D-6.8).
- `StrikingDistance`: `{ "MinPosition": 4, "MaxPosition": 20, "MinImpressions": 20 }`. The band is Onsite's;
  the minimum is our own setting.
- `LowCtrRatio`: `0.5`, our own setting, not a benchmark.

**Limits, said in every answer.** The API returns top rows, not every row, so sums are sums of top rows.
Data arrives two to three days late. The `[query, page]` call is truncated the same way, so a pair below the
row limit is missed.

**Access.** Kilian is not an Owner of the property (Search Console: "You were granted permissions by an
owner"), and only Owners add users, so the service account is out. The workbench reads with his own OAuth
consent: a Desktop client in a Google Cloud project he creates, consented once with `deno task gsc-consent`.
Its token lasts: the consent screen is **Internal** where the project belongs to a Google Cloud
organisation (publishing status "is not applicable to Internal"), otherwise **External, In production**
(Google states the 7-day expiry only for External in "Testing"). Hosting carries that token as a secret
(6.4).

**Not yet.** AI-assistant referrals (through the analytics workbench's GA4 route, #50), AI crawler logs (no
server logs), 404s from URLs AI assistants made up. Not taken from Onsite: multi-site portfolios, teams and
sharing, Google-update markers, chart polish. No schedule and no alerts (D-6.6).

## Alternatives considered and dropped

| Alternative | Why dropped | Log |
| --- | --- | --- |
| Tools over MCP only | Leaves out people and scripts. This is the narrow version @mcgear warned about. | #2–#4 |
| Two or three workbenches (site health, keywords, a Web front end joined with Consumes), game-night style | One question and one history. Splitting adds deploys and containers for no caller that needs it. | #11 |
| No workbench: API Source → data connection → warm query | An API Source cannot crawl HTML (JSON only, one page per poll, no redirects). Warm queries cannot write or fetch. | #14, #15, #16 |
| DataForSEO On-Page API instead of our own checks | Our checks are exactly the gaps on record, and free. On-Page (about $0.05 a crawl at about 300 pages) is a later add for checks we don't write. | #44, #45 |
| A no-port custom mode with a timer as the scheduler | The docs say a scheduled job is not a mode. It would also keep a replica running all the time. | #5 |
| Alerting to say when health breaks | Alerts are stored but "do not fire". | #20 |
| A weekly email through Communications | No send route for a workbench is documented. It needs the landing zone, and email is #31's. | #21 |
| Hosted App instead of a workbench | No modes, no MCP, our own image to build. | #26 |
| A model inside the workbench judging opportunities | The calling AI already judges; a model inside adds cost and a second voice. The workbench gathers, the AI judges, a person accepts | #49 |
| A browser visit to Search Console, as the main route or as a fallback | Google's API gives the same data, and more (URL Inspection). Kilian, 2026-11-20: no fallback needed | #48, #52 |
| A schedule (GitHub Actions) | Kilian, 2026-11-20: runs are on demand; a schedule only if a need appears | #46 |
| Waiting for a Search Console capability in the analytics workbench | The team-workbenches phase it was routed to was never written, and Search Console is an SEO capability (Kilian, 2026-11-20) | #24, #52 |

## Where it runs

Kilian's own workspace first. If it becomes a fixed part of dev-space operations, it moves to a team
workspace, and the repo is likely remade in a Fathym GitHub organisation then (Kilian, 2026-11-20).

## Risks found in the read (for 6.3, not 6.2)

- **The build may need a landing zone.** On both `integration` and round-10 docs, nothing builds until **Where images are kept** is saved
  in **Development**, which needs a connected cloud and a private landing zone (#9, #23). If Kilian's personal
  workspace has neither, hosting there is blocked until it does, or the build moves to a team workspace.
  `get_workspace` answers this first.
- **Connecting a personal GitHub account.** Development connects GitHub *organisations*. The repo is under
  `kcarrol`. Hosting builds clone it; access for Fathym is needed for a private repo (#9, #23).
- **Search Console access.** A service account added as a user on the property, or Kilian's one-time OAuth
  consent; whichever works, read-only.
- **A GitHub token for `Opportunities.Scan`.** Reading issues in the three repos needs a token with
  read access to them, held as an Environment value when hosted. A fine-grained, read-only token.
- **The DataForSEO balance.** The account started on the $1 trial with a $50 top-up planned. Check the
  balance (free `GET /v3/appendix/user_data`) before 6.2's first real pull.

## Not this

⛔ Not the product workbench planned in team-workbenches, and never named as it. ⛔ Nothing is added to the shared OpenX MCP server: this
workbench serves its own endpoint (S-5).
