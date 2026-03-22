import chalk from "chalk";
import TurndownService from "turndown";
import type { Article, Link } from "./fetcher";

export interface RenderedArticle {
  lines: string[];   // ANSI-colored lines
  plain: string;     // plain text version for --raw
  pageBreaks: number[]; // line indices where pages start
}

const TERM_WIDTH = Math.min(process.stdout.columns || 80, 88);
const CONTENT_WIDTH = TERM_WIDTH - 4; // 2 char left pad

// ─── Catppuccin Mocha palette ────────────────────────────────────────────────
const C = {
  purple:  chalk.hex("#cba6f7"),
  blue:    chalk.hex("#89b4fa"),
  cyan:    chalk.hex("#89dceb"),
  green:   chalk.hex("#a6e3a1"),
  yellow:  chalk.hex("#f9e2af"),
  red:     chalk.hex("#f38ba8"),
  text:    chalk.hex("#cdd6f4"),
  muted:   chalk.hex("#6c7086"),
  subtle:  chalk.hex("#45475a"),
  white:   chalk.hex("#d9e0ee"),
};

function wrap(text: string, width: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const visibleLen = stripAnsi(cur).length;
    const wordLen = stripAnsi(word).length;
    if (visibleLen + wordLen + (cur ? 1 : 0) > width) {
      if (cur) lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(n: number): string {
  return " ".repeat(n);
}

function hr(): string {
  return C.subtle("─".repeat(CONTENT_WIDTH));
}

function renderMarkdown(md: string, noColor: boolean): string[] {
  const lines: string[] = [];
  const rawLines = md.split("\n");

  let inCode = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];

    // fenced code blocks
    if (raw.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
      } else {
        inCode = false;
        const lang = raw.replace("```", "").trim();
        lines.push("");
        lines.push(pad(2) + C.subtle("┌─ ") + C.muted(lang || "code") + C.subtle(" " + "─".repeat(Math.max(0, CONTENT_WIDTH - 4 - (lang || "code").length))));
        for (const cl of codeBuffer) {
          const wrapped = wrap(cl, CONTENT_WIDTH - 4);
          for (const wl of wrapped) {
            lines.push(pad(2) + C.subtle("│ ") + C.green(wl));
          }
        }
        lines.push(pad(2) + C.subtle("└" + "─".repeat(CONTENT_WIDTH - 2)));
        lines.push("");
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    // headings
    if (raw.startsWith("### ")) {
      lines.push("");
      const text = raw.slice(4);
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.cyan.bold(l));
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("## ")) {
      lines.push("");
      const text = raw.slice(3);
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.blue.bold("▋ ") + C.blue.bold(l));
      }
      lines.push(pad(2) + C.subtle("─".repeat(Math.min(stripAnsi(text).length + 2, CONTENT_WIDTH))));
      lines.push("");
      continue;
    }
    if (raw.startsWith("# ")) {
      lines.push("");
      const text = raw.slice(2);
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.purple.bold(l));
      }
      lines.push("");
      continue;
    }

    // blockquotes
    if (raw.startsWith("> ")) {
      const text = raw.slice(2);
      for (const l of wrap(text, CONTENT_WIDTH - 4)) {
        lines.push(pad(2) + C.purple("┃ ") + C.muted(l));
      }
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(raw.trim()) || /^\*\*\*+$/.test(raw.trim())) {
      lines.push("");
      lines.push(pad(2) + hr());
      lines.push("");
      continue;
    }

    // unordered list
    if (/^\s*[-*+] /.test(raw)) {
      const indent = raw.match(/^(\s*)/)?.[1]?.length ?? 0;
      const text = raw.replace(/^\s*[-*+] /, "");
      const styled = styleInline(text, noColor);
      const extra = pad(2 + indent + 2);
      const firstPrefix = pad(2 + indent) + C.yellow("• ");
      const wrapped = wrap(styled, CONTENT_WIDTH - indent - 4);
      lines.push(firstPrefix + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(extra + wrapped[j]);
      }
      continue;
    }

    // ordered list
    if (/^\d+\. /.test(raw)) {
      const num = raw.match(/^(\d+)\./)?.[1] ?? "1";
      const text = raw.replace(/^\d+\. /, "");
      const styled = styleInline(text, noColor);
      const wrapped = wrap(styled, CONTENT_WIDTH - 6);
      lines.push(pad(2) + C.yellow(`${num}.`) + " " + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(pad(6) + wrapped[j]);
      }
      continue;
    }

    // blank line
    if (!raw.trim()) {
      lines.push("");
      continue;
    }

    // normal paragraph
    const styled = styleInline(raw, noColor);
    const wrapped = wrap(styled, CONTENT_WIDTH);
    for (const l of wrapped) {
      lines.push(pad(2) + l);
    }
  }

  return lines;
}

function styleInline(text: string, noColor: boolean): string {
  if (noColor) return text.replace(/[*_`[\]()]/g, "");

  return text
    // bold+italic
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => C.white.bold.italic(t))
    // bold
    .replace(/\*\*(.+?)\*\*/g, (_, t) => C.white.bold(t))
    // italic
    .replace(/\*(.+?)\*/g, (_, t) => C.white.italic(t))
    // inline code
    .replace(/`([^`]+)`/g, (_, t) => C.green("`") + C.green(t) + C.green("`"))
    // links — show text, dim url hint
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const host = (() => {
        try { return new URL(url).hostname; } catch { return url; }
      })();
      return C.cyan.underline(label) + C.muted(` (${host})`);
    })
    // bare URLs
    .replace(/https?:\/\/\S+/g, (u) => C.cyan.underline(u))
    // remaining markdown symbols
    .replace(/[*_]/g, "");
}

const tdService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
tdService.remove(["script", "style", "figure", "picture", "img", "iframe", "nav", "aside", "footer"]);

function renderLinks(links: Link[]): string[] {
  if (!links.length) return [];

  const lines: string[] = [];
  lines.push("");
  lines.push(pad(2) + hr());
  lines.push("");
  lines.push(pad(2) + C.yellow.bold("🔗 Links") + C.muted(` (${links.length})`));
  lines.push("");

  // Group links by host
  const byHost = new Map<string, Link[]>();
  for (const link of links) {
    const arr = byHost.get(link.host) || [];
    arr.push(link);
    byHost.set(link.host, arr);
  }

  let idx = 1;
  for (const [host, hostLinks] of byHost) {
    lines.push(pad(2) + C.cyan(host));
    for (const link of hostLinks) {
      const num = C.yellow(`[${idx}]`);
      const text = link.text.length > 60 ? link.text.slice(0, 57) + "..." : link.text;
      const wrapped = wrap(text, CONTENT_WIDTH - 10);
      lines.push(pad(4) + num + " " + C.white(wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(pad(8) + wrapped[j]);
      }
      lines.push(pad(8) + C.muted.underline(link.url));
      idx++;
    }
    lines.push("");
  }

  return lines;
}

export function renderArticle(
  article: Article,
  opts: { noColor?: boolean } = {}
): RenderedArticle {
  const noColor = opts.noColor ?? false;
  const lines: string[] = [];

  // ── Top spacer
  lines.push("");

  // ── Site name
  if (article.siteName) {
    lines.push(pad(2) + C.muted(article.siteName.toUpperCase()));
    lines.push("");
  }

  // ── Title
  const titleLines = wrap(article.title, CONTENT_WIDTH);
  for (const l of titleLines) {
    lines.push(pad(2) + C.purple.bold(l));
  }
  lines.push("");

  // ── Meta line
  const metaParts: string[] = [];
  if (article.byline) metaParts.push(C.cyan(article.byline));
  if (article.publishedTime) metaParts.push(C.muted(article.publishedTime));
  metaParts.push(C.green(`~${article.readingTime} min read`));
  metaParts.push(C.muted(`${article.wordCount.toLocaleString()} words`));
  lines.push(pad(2) + metaParts.join(C.subtle("  ·  ")));

  // ── Tags
  if (article.tags.length) {
    const tagStr = article.tags
      .map((t) => C.subtle("[") + C.muted(t) + C.subtle("]"))
      .join(" ");
    lines.push(pad(2) + tagStr);
  }

  lines.push("");
  lines.push(pad(2) + hr());
  lines.push("");

  // ── Body
  const markdown = tdService.turndown(article.content);
  const bodyLines = renderMarkdown(markdown, noColor);
  for (const l of bodyLines) {
    lines.push(l);
  }

  // ── Links section
  const linkLines = renderLinks(article.links);
  for (const l of linkLines) {
    lines.push(l);
  }

  // ── Footer
  lines.push("");
  lines.push(pad(2) + hr());
  lines.push("");
  lines.push(pad(2) + C.muted("source: ") + C.cyan.underline(article.url));
  lines.push("");

  // ── Page breaks (every ~terminal-height lines)
  const pageHeight = (process.stdout.rows || 40) - 5;
  const pageBreaks: number[] = [0];
  for (let i = pageHeight; i < lines.length; i += pageHeight) {
    pageBreaks.push(i);
  }

  // ── Plain text version
  const plain = lines.map(stripAnsi).join("\n");

  return { lines, plain, pageBreaks };
}
