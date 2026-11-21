/**
 * The watch list's default path is a file path on every platform (fathym-deno/fathym-dev-space#143, QA
 * 2026-11-20): `URL.pathname` gave `/C:/…` on Windows, which can't be opened.
 */
import { assertEquals } from "@std/assert";
import { fromFileUrl as fromWindowsFileUrl } from "@std/path/windows";
import { watchlistPath, watchlistPathFor } from "../src/config.ts";

Deno.test("watchlist path - a Windows module URL resolves to a Windows path", () => {
  assertEquals(
    watchlistPathFor(
      "file:///C:/Users/mj/fathym-search-health/src/config.ts",
      fromWindowsFileUrl,
    ),
    "C:\\Users\\mj\\fathym-search-health\\watchlist.json",
  );
});

Deno.test("watchlist path - the default opens on this machine", async () => {
  const saved = Deno.env.get("SEARCH_HEALTH_WATCHLIST");
  Deno.env.delete("SEARCH_HEALTH_WATCHLIST");
  try {
    const stat = await Deno.stat(watchlistPath());
    assertEquals(stat.isFile, true);
  } finally {
    if (saved !== undefined) Deno.env.set("SEARCH_HEALTH_WATCHLIST", saved);
  }
});
