import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface Article {
  title: string;
  byline: string | null;
  siteName: string | null;
  content: string;
  textContent: string;
  publishedTime: string | null;
  url: string;
  wordCount: number;
  readingTime: number;
  tags: string[];
  links: Link[];
}

export interface Link {
  text: string;
  url: string;
  host: string;
}

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function extractTags(doc: Document): string[] {
  const metaKeywords = doc.querySelector('meta[name="keywords"]');
  if (metaKeywords) {
    const content = metaKeywords.getAttribute("content");
    if (content) {
      return content
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 4);
    }
  }

  const ogTags: string[] = [];
  const section = doc.querySelector('meta[property="article:section"]');
  if (section) {
    const val = section.getAttribute("content");
    if (val) ogTags.push(val.toLowerCase());
  }
  return ogTags.slice(0, 4);
}

function extractPublishedTime(doc: Document): string | null {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="DC.date"]',
    'time[datetime]',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const val =
        el.getAttribute("content") || el.getAttribute("datetime") || null;
      if (val) {
        try {
          const d = new Date(val);
          return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractLinks(doc: Document, baseUrl: string): Link[] {
  const seen = new Set<string>();
  const links: Link[] = [];

  const anchors = doc.querySelectorAll("a[href]");
  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const text = (a.textContent || "").trim().replace(/\s+/g, " ");
    if (!text || text.length > 200) continue;

    let host: string;
    try {
      host = new URL(resolvedUrl).hostname;
    } catch {
      continue;
    }

    links.push({ text, url: resolvedUrl, host });
  }

  return links;
}

export async function fetchArticle(url: string): Promise<Article> {
  process.stderr.write(`\r  \x1b[36mfetching\x1b[0m  ${url}\n`);

  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — could not fetch ${url}`);
  }

  const html = await res.text();
  process.stderr.write(
    `\r  \x1b[36mextracting\x1b[0m  article content via readability...\n`
  );

  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Extract metadata BEFORE readability mutates the DOM
  const tags = extractTags(doc);
  const publishedTime = extractPublishedTime(doc);
  const links = extractLinks(doc, url);

  const reader = new Readability(doc);
  const parsed = reader.parse();

  if (!parsed) {
    throw new Error("Could not extract article content. The page may require JavaScript or a login.");
  }

  const wordCount = parsed.textContent
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));

  process.stderr.write(
    `\r  \x1b[32mrendering\x1b[0m  ~${readingTime} min read · ${wordCount.toLocaleString()} words\n`
  );

  return {
    title: parsed.title,
    byline: parsed.byline,
    siteName: parsed.siteName,
    content: parsed.content,
    textContent: parsed.textContent,
    publishedTime,
    url,
    wordCount,
    readingTime,
    tags,
    links,
  };
}
