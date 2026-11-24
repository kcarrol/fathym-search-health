/**
 * Search Console access, read-only (`webmasters.readonly`). The credential file holds one of two shapes:
 * - an OAuth refresh-token file (`client_id`, `client_secret`, `refresh_token`), written by
 *   `deno task gsc-consent`. The route in use (6.3): anyone with access to the property can consent.
 * - a service-account JSON key (`client_email`, `private_key`), signing its own token (as the analytics
 *   workbench does for GA4). Only a property Owner can add the service account as a user.
 * The file is GSC_CREDENTIALS (default ~/.config/search-health/gsc.json), never in the repo.
 */
import { join } from "@std/path";
import { env } from "../config.ts";

export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function credentialsPath(): string {
  return env("GSC_CREDENTIALS") ?? join(env("HOME") ?? ".", ".config", "search-health", "gsc.json");
}

export type TokenSource = () => Promise<string>;

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function serviceAccountToken(key: { client_email: string; private_key: string; token_uri?: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const aud = key.token_uri ?? TOKEN_URL;
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${
    b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 }))
  }`;
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned)));
  return exchange(aud, { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` });
}

async function exchange(url: string, form: Record<string, string>): Promise<string> {
  const res = await fetch(url, { method: "POST", body: new URLSearchParams(form), signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token exchange refused: ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return body.access_token as string;
}

/** A token source from the credentials file, refreshed when it has expired. */
export function fileTokenSource(path = credentialsPath()): TokenSource {
  let cached: { token: string; until: number } | undefined;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    let creds: Record<string, string>;
    try {
      creds = JSON.parse(await Deno.readTextFile(path));
    } catch {
      throw new Error(`No Search Console credential at ${path}. See README.md, "Search Console access".`);
    }
    const token = creds.private_key && creds.client_email
      ? await serviceAccountToken(creds as { client_email: string; private_key: string; token_uri?: string })
      : creds.refresh_token && creds.client_id && creds.client_secret
      ? await exchange(TOKEN_URL, { grant_type: "refresh_token", client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: creds.refresh_token })
      : (() => {
        throw new Error(`${path} is neither a service-account key nor an OAuth refresh-token file.`);
      })();
    cached = { token, until: Date.now() + 50 * 60_000 };
    return token;
  };
}
