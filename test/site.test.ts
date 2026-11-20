import { assert, assertEquals } from "@std/assert";
import { readPage, samePage } from "../src/site/html.ts";
import { checkSite } from "../src/site/check.ts";
import type { Fetched } from "../src/site/sitemap.ts";

const SITE = "https://x.test";

Deno.test("html: links resolve against <base href>, not the page URL (the /blog trap)", () => {
  const f = readPage(`<html><head><base href="/"><title> A &amp; B </title><link rel="canonical" href="https://x.test/blog/a">
<meta name="robots" content="index,follow"></head><body><h1>x</h1><a href="./fai">fAI</a><a href="#top">t</a><a href="mailto:a@b">m</a></body></html>`, `${SITE}/blog/a`);
  assertEquals(f.Links, [`${SITE}/fai`]);
  assertEquals(f.Title, "A & B");
  assertEquals(f.Canonical, `${SITE}/blog/a`);
  assertEquals(f.NoIndex, false);
  assertEquals(f.H1Count, 1);
});

Deno.test("html: noindex, two H1s, and a trailing slash is the same page", () => {
  const f = readPage(`<meta content="noindex, nofollow" name="robots"><h1>a</h1><h1 class="sr-only">b</h1>`, `${SITE}/x`);
  assert(f.NoIndex);
  assertEquals(f.H1Count, 2);
  assert(samePage(`${SITE}/a/`, `${SITE}/a`));
  assert(!samePage(`${SITE}/a`, `${SITE}/b`));
});

/** A small fake site: one good page, one with every defect, a redirect, and a soft-200 catch-all. */
function fakeSite(): (url: string) => Promise<Fetched> {
  const page = (body: string, Status = 200, ContentType = "text/html") => ({ Status, ContentType, Body: body });
  const routes: Record<string, { Status: number; ContentType: string; Body: string; Location?: string }> = {
    "/robots.txt": page("User-agent: *", 200, "text/plain"),
    "/sitemap.xml": page(`<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/bad</loc></url><url><loc>${SITE}/old</loc></url><url><loc>${SITE}/twin</loc></url></urlset>`, 200, "application/xml"),
    "/": page(`<title>Home</title><link rel="canonical" href="${SITE}/"><h1>Home</h1><a href="/missing">x</a><a href="/bad">y</a>`),
    "/bad": page(`<title>Home</title><link rel="canonical" href="${SITE}/"><meta name="robots" content="noindex"><h1>a</h1><h1>b</h1>`),
    "/old": { Status: 301, ContentType: "", Body: "", Location: `${SITE}/` },
    "/twin": page(`<h1>t</h1>`),
  };
  return (url: string) => {
    const path = new URL(url).pathname;
    const r = routes[path] ?? (path.startsWith("/probe") ? page("<title>Not found</title>") : { Status: 404, ContentType: "text/html", Body: "" });
    return Promise.resolve({ Url: url, FetchedAt: "2026-11-20T00:00:00Z", ...r });
  };
}

Deno.test("check: finds each kind of defect, with what was fetched and when", async () => {
  const r = await checkSite(SITE, fakeSite(), { ProbePaths: ["/probe-1"] });
  const kinds = (u: string) => r.Issues.filter((i) => i.Url === u).map((i) => i.Kind).sort();
  assertEquals(r.SitemapUrls.length, 4);
  assertEquals(kinds(`${SITE}/bad`), ["canonical-elsewhere", "duplicate-title", "multiple-h1", "noindex-in-sitemap"]);
  assertEquals(kinds(`${SITE}/`), ["duplicate-title"]);
  assertEquals(kinds(`${SITE}/old`), ["sitemap-url-redirects"]);
  assertEquals(kinds(`${SITE}/twin`), ["canonical-missing", "title-missing"]);
  assertEquals(kinds(`${SITE}/probe-1`), ["soft-200"]);
  const broken = r.Issues.find((i) => i.Kind === "broken-link")!;
  assertEquals(broken.Url, `${SITE}/missing`);
  assertEquals(broken.Evidence.LinkedFrom, [`${SITE}/`]);
  assert(r.Issues.every((i) => i.Evidence.FetchedAt && typeof i.Evidence.Status === "number"));
});

Deno.test("check: no robots.txt and no sitemap are issues, not crashes", async () => {
  const r = await checkSite(SITE, (url) => Promise.resolve({ Url: url, Status: 200, ContentType: "text/html", Body: "<html>app shell</html>", FetchedAt: "t" }), { ProbePaths: [] });
  assertEquals(r.Issues.map((i) => i.Kind).sort(), ["robots-missing", "sitemap-missing"]);
});
