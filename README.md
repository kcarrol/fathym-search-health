# search-health

Is fathym.com healthy for search engines and AI crawlers, and what should we write next? See
[`PROBLEM.md`](PROBLEM.md) for the problem, [`DESIGN.md`](DESIGN.md) for the shape, and
[`FEATURE-LOG.md`](FEATURE-LOG.md) for what of the platform it uses and why.

A fai workbench with three modes. Runs are on demand: nothing here runs on a schedule.

| Mode | Run | For |
| --- | --- | --- |
| MCP | `deno task mcp`, or open Claude Code in this folder (`.mcp.json` registers it) | any AI |
| API | `deno task api` → http://localhost:4968 (`/openapi.json` lists the routes) | scripts |
| Web | `deno task web` → http://localhost:4969 | people |

The ports are the declared ones; locally, fai moves to a free port if one is taken, and says which in the
banner.

## Tools

| MCP name | API route | Does | Cost |
| --- | --- | --- | --- |
| `site-check` | `POST /site/check` | robots.txt, sitemap, every sitemap page, soft-200 probes, internal links | free |
| `keywords-pull` | `POST /keywords/pull` | DataForSEO: what we rank for, suggestions around each seed, volume, SERP with AI Overview. `{"DryRun": true}` shows the estimate only | about $0.42 a run with the default watch list |
| `searchconsole-pull` | `POST /searchconsole/pull` | Search Console: queries, pages, URL Inspection over a rotating sitemap batch, sitemaps | free (no price stated by Google) |
| `opportunities-scan` | `POST /opportunities/scan` | issues changed since the last scan in dev-space, web-runtime and fathym-research, with the watch-list terms each mentions | free |
| `report-current` | `POST /report/current` | the latest answer of each kind, and what changed since the run before | free |
| `report-history` | `POST /report/history` | past runs of one kind | free |
| `report-export` | `POST /report/export` | writes the latest results into dev-space (`research/fathym-marketing/demand/` and `site-health/`) for a person to commit | free |

API bodies are the method's fields directly, e.g. `{"DryRun": true}`, not wrapped.

Prompts: `weekly-site-review`, `opportunity-review`.

## What it reads and where it keeps things

| Env | Default | What |
| --- | --- | --- |
| `SEARCH_HEALTH_DATA` | `~/.search-health` | the fai vault: one snapshot per run, `snapshots/{time}-{kind}.json` |
| `SEARCH_HEALTH_WATCHLIST` | `./watchlist.json` | seeds, scan terms, pages and pull limits. A person edits it; no tool writes it |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`, or `DATAFORSEO_ENV_FILE` | `~/.config/dataforseo/env` | DataForSEO credentials |
| `GSC_CREDENTIALS` | `~/.config/search-health/gsc.json` | Search Console credential (below) |
| `GSC_PROPERTY` | `sc-domain:fathym.com` | the Search Console property (`https://www.fathym.com/` for a URL-prefix one) |
| `GITHUB_TOKEN` | `gh auth token` at run time | for the opportunities scan; never written anywhere |
| `FATHYM_DEV_SPACE` | `~/fathym-dev-space` | where `report-export` writes |

⛔ No credential is ever committed: `.gitignore` excludes `.env`, and every credential above lives outside
the repo.

## Search Console access

Not set up yet (6.2.4). Google's docs say requests must be authorised by an authenticated user with OAuth
2.0, read-only scope `https://www.googleapis.com/auth/webmasters.readonly`; whether a service account
works is not stated. Try the service account first:

1. In Google Cloud, pick or create a project and enable the **Google Search Console API**.
2. Create a service account (no roles needed), then a **JSON key** for it. Save it as
   `~/.config/search-health/gsc.json` (`chmod 600`).
3. In Search Console, open the fathym.com property → **Settings → Users and permissions → Add user**: the
   service account's email (`…@….iam.gserviceaccount.com`), permission **Restricted**.
4. Run `searchconsole-pull`. Record any refusal word for word in the Session Log.

If Google refuses the service account, use OAuth instead: create an OAuth client (Desktop app) in the same
project, sign in once as a user with access to the property, and save
`{"client_id", "client_secret", "refresh_token"}` as the same file. The workbench reads either shape.

## Tests

`deno task test`: site checks, DataForSEO parsing against recorded responses (2026-11-20), Search Console
against Google's documented response shapes, the opportunities scan, the report, and the workbench through
`fai run` over MCP, the API and the Web page.

fai is pinned to 0.0.1009 in `deno.jsonc`, the version that runs it.
