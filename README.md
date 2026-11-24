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
| `searchconsole-pull` | `POST /searchconsole/pull` | Search Console: queries, pages and the two together, this period and the one before; URL Inspection over a rotating sitemap batch; sitemaps. `report-current` derives striking distance, falling, low CTR for the position, cannibalisation, the branded split and indexing history | free (no price stated by Google) |
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

Read-only, scope `https://www.googleapis.com/auth/webmasters.readonly`, through Google's API. The credential
file is `GSC_CREDENTIALS` (default `~/.config/search-health/gsc.json`), outside the repo; the workbench reads
either shape below.

**Your own sign-in (OAuth), for anyone with access to the property.** This is the route in use (6.3).

1. In Google Cloud, signed in as the account that can see fathym.com in Search Console, create a project and
   enable the **Google Search Console API**.
2. **Google Auth Platform → Audience** (the OAuth consent screen): choose **Internal** if it is offered (the
   project belongs to a Google Cloud organisation). Otherwise choose **External** and **Publish app** to
   *In production*: in *Testing*, Google expires the refresh token after 7 days. An unverified External app
   shows an "unverified app" screen once; continue past it for your own account.
3. **Clients → Create client → Desktop app.** Download its JSON to `~/.config/search-health/client.json`.
4. Run `deno task gsc-consent ~/.config/search-health/client.json`. A browser opens; sign in and allow read
   access. It saves `~/.config/search-health/gsc.json` (mode 600) and lists the properties your account can
   read, with your permission on each. It never prints a token.
5. If the property it lists is not `sc-domain:fathym.com`, set `GSC_PROPERTY` to the one it lists.
6. Run `searchconsole-pull`.

**A service account, if you are an Owner of the property** (only Owners add users): create a service account
and a JSON key in the same project, save the key as the credential file (`chmod 600`), and add the service
account's email to the property as a **Restricted** user under Settings → Users and permissions.

## Tests

`deno task test`: site checks, DataForSEO parsing against recorded responses (2026-11-20), Search Console
against Google's documented response shapes and its six reports, the consent helper and the OAuth token
exchange (no network), the opportunities scan, the report and its export, the Web page, and the workbench
through `fai run` over MCP, the API and the Web page.

fai is pinned to 0.0.1009 in `deno.jsonc`, the version that runs it.
