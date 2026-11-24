/** The consent helper's pieces that don't need Google: the client file, the auth URL, PKCE and the saved file. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { authUrl, pkce, readClient, saveCredential } from "../scripts/gsc-consent.ts";
import { SCOPE } from "../src/gsc/auth.ts";

Deno.test("consent: reads a Desktop client file and refuses anything else", () => {
  assertEquals(readClient(JSON.stringify({ installed: { client_id: "id", client_secret: "s", project_id: "p" } })), { client_id: "id", client_secret: "s" });
  assertThrows(() => readClient(JSON.stringify({ web: { client_id: "id", client_secret: "s" } })), Error, "Desktop app");
});

Deno.test("consent: the auth URL asks for offline, read-only access with PKCE", async () => {
  const { verifier, challenge } = await pkce();
  assert(verifier.length >= 43 && !verifier.includes("="));
  const u = new URL(authUrl("id", "http://127.0.0.1:1234", challenge, "st"));
  const p = u.searchParams;
  assertEquals([p.get("scope"), p.get("access_type"), p.get("prompt"), p.get("code_challenge_method")], [SCOPE, "offline", "consent", "S256"]);
  assertEquals([p.get("redirect_uri"), p.get("state"), p.get("code_challenge")], ["http://127.0.0.1:1234", "st", challenge]);
});

Deno.test("consent: the saved file is the shape auth.ts reads, owner-only", async () => {
  const path = join(await Deno.makeTempDir(), "nested", "gsc.json");
  await saveCredential(path, { client_id: "id", client_secret: "s" }, "rt");
  assertEquals(JSON.parse(await Deno.readTextFile(path)), { client_id: "id", client_secret: "s", refresh_token: "rt" });
  if (Deno.build.os !== "windows") assertEquals((await Deno.stat(path)).mode! & 0o777, 0o600);
});
