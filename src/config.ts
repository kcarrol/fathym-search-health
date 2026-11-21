/**
 * Where the workbench keeps things and finds its credentials. Everything comes from the environment, so
 * the same entry runs on a laptop and, later, hosted. Credentials are read when a tool needs them and are
 * never logged or returned.
 */
import { fromFileUrl, join } from "@std/path";

/** An environment value, with an empty string (as .mcp.json passes an unset one) read as unset. */
export const env = (name: string): string | undefined => Deno.env.get(name) || undefined;

const home = () => env("HOME") ?? env("USERPROFILE") ?? ".";

/** The site this workbench watches. */
export const SITE = env("SEARCH_HEALTH_SITE") ?? "https://www.fathym.com";

/** The fai vault folder that holds every run's snapshot. */
export function dataDir(): string {
  return env("SEARCH_HEALTH_DATA") ?? join(home(), ".search-health");
}

/** The dev-space checkout that `Report.Export` writes into. */
export function devSpaceDir(): string {
  return env("FATHYM_DEV_SPACE") ?? join(home(), "fathym-dev-space");
}

/** The watch list: seed terms and pages, edited by a person. */
export function watchlistPath(): string {
  return env("SEARCH_HEALTH_WATCHLIST") ?? watchlistPathFor(import.meta.url);
}

/**
 * The watch list beside the repo root, as a file path for this platform. `URL.pathname` gave `/C:/…` on
 * Windows, which can't be opened (fathym-deno/fathym-dev-space#143, QA 2026-11-20).
 */
export function watchlistPathFor(moduleUrl: string | URL, toPath: (url: URL) => string = fromFileUrl): string {
  return toPath(new URL("../watchlist.json", moduleUrl));
}

/** DataForSEO login and password, from env or from a KEY=VALUE file (default ~/.config/dataforseo/env). */
export async function dataForSeoCredentials(): Promise<{ Login: string; Password: string }> {
  let login = env("DATAFORSEO_LOGIN");
  let password = env("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    const file = env("DATAFORSEO_ENV_FILE") ?? join(home(), ".config", "dataforseo", "env");
    try {
      const vars = parseEnvFile(await Deno.readTextFile(file));
      login ??= vars.DATAFORSEO_LOGIN;
      password ??= vars.DATAFORSEO_PASSWORD;
    } catch {
      // fall through to the error below
    }
  }
  if (!login || !password) {
    throw new Error("No DataForSEO credentials: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, or DATAFORSEO_ENV_FILE.");
  }
  return { Login: login, Password: password };
}

/** Parses KEY=VALUE lines, allowing `export` and quotes. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const at = line.indexOf("=");
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** A GitHub token: GITHUB_TOKEN, else `gh auth token` at run time. Never written anywhere. */
export async function githubToken(): Promise<string> {
  const fromEnv = env("GITHUB_TOKEN");
  if (fromEnv) return fromEnv;
  const out = await new Deno.Command("gh", { args: ["auth", "token"], stdout: "piped", stderr: "null" }).output()
    .catch(() => undefined);
  const token = out?.success ? new TextDecoder().decode(out.stdout).trim() : "";
  if (!token) throw new Error("No GitHub token: set GITHUB_TOKEN, or sign in with `gh auth login`.");
  return token;
}
