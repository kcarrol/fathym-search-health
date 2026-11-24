/**
 * One-time Search Console consent (6.3.2): `deno task gsc-consent <client.json>`.
 *
 * Google's loopback flow for installed apps, with PKCE. Reads the Desktop client JSON downloaded from Google
 * Cloud, opens the browser, waits for the redirect on 127.0.0.1, swaps the code for a refresh token, and saves
 * `{client_id, client_secret, refresh_token}` as the credential file (`GSC_CREDENTIALS`, mode 600). Then it
 * lists the properties the account can read. It never prints a token or the client secret.
 */
import { dirname } from "@std/path";
import { credentialsPath, SCOPE } from "../src/gsc/auth.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";

export interface Client { client_id: string; client_secret: string }

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The Desktop client from Google Cloud's download (`{"installed": {...}}`). */
export function readClient(json: string): Client {
  const c = (JSON.parse(json).installed ?? {}) as Partial<Client>;
  if (!c.client_id || !c.client_secret) throw new Error('Not a Desktop app client file: expected {"installed": {"client_id", "client_secret"}}.');
  return { client_id: c.client_id, client_secret: c.client_secret };
}

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export function authUrl(clientId: string, redirect: string, challenge: string, state: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state,
  }).toString();
  return u.toString();
}

/** Writes the credential file the workbench reads, readable by the owner only. */
export async function saveCredential(path: string, client: Client, refreshToken: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify({ ...client, refresh_token: refreshToken }, null, 2), { mode: 0o600 });
  if (Deno.build.os !== "windows") await Deno.chmod(path, 0o600);
}

function openBrowser(url: string) {
  const [cmd, args] = Deno.build.os === "darwin" ? ["open", [url]]
    : Deno.build.os === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  try {
    new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).spawn();
  } catch { /* the URL is printed below as well */ }
}

async function main() {
  const clientPath = Deno.args[0];
  if (!clientPath) throw new Error("Usage: deno task gsc-consent <path to the Desktop client JSON from Google Cloud>");
  const json = await Deno.readTextFile(clientPath).catch(() => {
    throw new Error(`No client file at ${clientPath}. Create a Desktop app client in Google Cloud and save its JSON there first (README.md, "Search Console access", steps 1-3).`);
  });
  const client = readClient(json);
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

  let done!: (code: string) => void;
  let fail!: (e: Error) => void;
  const got = new Promise<string>((res, rej) => [done, fail] = [res, rej]);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
    const p = new URL(req.url).searchParams;
    if (p.get("state") !== state) return new Response("State mismatch; close this tab.", { status: 400 });
    if (p.get("error")) fail(new Error(`Google refused consent: ${p.get("error")}`));
    else if (p.get("code")) done(p.get("code")!);
    return new Response("search-health: consent received. You can close this tab.");
  });
  const redirect = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
  const url = authUrl(client.client_id, redirect, challenge, state);
  console.log("Opening your browser to sign in. If it doesn't open, visit:\n" + url + "\n");
  openBrowser(url);

  const code = await got.finally(() => server.shutdown());
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) throw new Error(`Token exchange refused: ${res.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());

  const out = credentialsPath();
  await saveCredential(out, client, body.refresh_token);
  console.log(`Saved the credential to ${out} (mode 600).`);

  const sites = await fetch(SITES_URL, { headers: { Authorization: `Bearer ${body.access_token}` } }).then((r) => r.json());
  const entries = (sites.siteEntry ?? []) as { siteUrl: string; permissionLevel: string }[];
  console.log(entries.length ? "Properties this account can read:\n" + entries.map((e) => `  ${e.siteUrl}  (${e.permissionLevel})`).join("\n") : `No properties listed: ${JSON.stringify(sites).slice(0, 200)}`);
}

if (import.meta.main) await main();
