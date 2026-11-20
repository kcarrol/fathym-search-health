/**
 * What the site checks read from a page's HTML. Regex over our own site's markup, not a general HTML
 * parser: it reads the head tags the checks need and every <a href>.
 */

export interface PageFacts {
  Title: string;
  Canonical?: string;
  /** The page's own <base href>, resolved. Relative links resolve against it, not the page URL. */
  Base?: string;
  NoIndex: boolean;
  H1Count: number;
  /** Every <a href>, resolved to an absolute URL without its #fragment. */
  Links: string[];
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

export function readPage(html: string, pageUrl: string): PageFacts {
  const tags = (re: RegExp) => [...html.matchAll(re)].map((m) => m[0]);

  const baseHref = tags(/<base\b[^>]*>/gi).map((t) => attr(t, "href")).find(Boolean);
  const base = baseHref ? new URL(decode(baseHref), pageUrl).href : undefined;

  const canonicalTag = tags(/<link\b[^>]*>/gi).find((t) => (attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"));
  const canonicalHref = canonicalTag ? attr(canonicalTag, "href") : undefined;

  const robots = tags(/<meta\b[^>]*>/gi)
    .filter((t) => ["robots", "googlebot"].includes((attr(t, "name") ?? "").toLowerCase()))
    .map((t) => (attr(t, "content") ?? "").toLowerCase());

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

  const links = new Set<string>();
  for (const t of tags(/<a\b[^>]*>/gi)) {
    const href = attr(t, "href");
    if (!href) continue;
    const h = decode(href);
    if (/^(mailto:|tel:|javascript:|#)/i.test(h)) continue;
    try {
      const u = new URL(h, base ?? pageUrl);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      links.add(u.href);
    } catch {
      // an href that isn't a URL is skipped, not reported
    }
  }

  return {
    Title: decode(title),
    Canonical: canonicalHref ? new URL(decode(canonicalHref), pageUrl).href : undefined,
    Base: base,
    NoIndex: robots.some((c) => c.split(/[\s,]+/).includes("noindex")),
    H1Count: (html.match(/<h1\b/gi) ?? []).length,
    Links: [...links],
  };
}

/** Same page regardless of a trailing slash: `/a/` and `/a` compare equal. */
export function samePage(a: string, b: string): boolean {
  const n = (s: string) => {
    const u = new URL(s);
    u.hash = "";
    return (u.origin + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  };
  return n(a) === n(b);
}
