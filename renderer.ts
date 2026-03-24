import chalk from "chalk";
import TurndownService from "turndown";
import type { Article, Link } from "./fetcher";

export interface RenderedArticle {
  lines: string[];   // ANSI-colored lines (collapsed links by default)
  plain: string;     // plain text version for --raw
  pageBreaks: number[]; // line indices where pages start
  linksStart: number;   // line index where links section starts (-1 if no links)
  linksFull: string[];  // full link lines
  linksCollapsed: string[]; // collapsed link lines (first 5 + hint)
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
  code:    chalk.bgHex("#313244").hex("#a6e3a1"),
  codeBlock: chalk.bgHex("#1e1e2e").hex("#a6e3a1"),
};

const SITE_ACCENT = [C.purple, C.blue, C.cyan, C.green, C.yellow, C.red, C.white];

function siteAccentColor(url: string, themeColor: string | null) {
  if (themeColor) return chalk.hex(themeColor);
  let hash = 0;
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  for (let i = 0; i < host.length; i++) {
    hash = ((hash << 5) - hash + host.charCodeAt(i)) | 0;
  }
  return SITE_ACCENT[Math.abs(hash) % SITE_ACCENT.length];
}

function osc8(url: string, text: string): string {
  return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07";
}

function smartenText(input: string): string {
  let s = input;
  s = s.replace(/\.{3}/g, "…");
  s = s.replace(/---/g, "—").replace(/--/g, "—");
  s = s.replace(/\b([A-Z])\. ([A-Z])\./g, "$1.\u00a0$2.");
  s = smartQuotes(s);
  return s;
}

function smartQuotes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : "";
    const next = i + 1 < s.length ? s[i + 1] : "";

    if (ch === "\"") {
      const isOpen = !prev || /[\s([{<]/.test(prev);
      out += isOpen ? "“" : "”";
      continue;
    }
    if (ch === "'") {
      const isApos = /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next);
      if (isApos) {
        out += "’";
      } else {
        const isOpen = !prev || /[\s([{<]/.test(prev);
        out += isOpen ? "‘" : "’";
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function smartenInline(text: string): string {
  const parts = text.split(/(`[^`]*`)/g);
  return parts.map((part) => {
    if (part.startsWith("`") && part.endsWith("`")) return part;
    const segs = part.split(/(https?:\/\/\S+)/g);
    return segs
      .map((seg) => (seg.startsWith("http") ? seg : smartenText(seg)))
      .join("");
  }).join("");
}

function wrap(text: string, width: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const chunks = splitLongWord(word, width);
    for (const chunk of chunks) {
      const visibleLen = stripAnsi(cur).length;
      const wordLen = stripAnsi(chunk).length;
      if (visibleLen + wordLen + (cur ? 1 : 0) > width) {
        if (cur) lines.push(cur);
        cur = chunk;
      } else {
        cur = cur ? `${cur} ${chunk}` : chunk;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function splitLongWord(word: string, width: number): string[] {
  if (stripAnsi(word).length <= width) return [word];
  if (/\x1b\[[0-9;]*m/.test(word) || /\x1b\]8;;/.test(word)) return [word];
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += width) {
    chunks.push(word.slice(i, i + width));
  }
  return chunks.length ? chunks : [word];
}

function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\]8;;[^\x07]*\x07/g, "")   // OSC 8 hyperlink start
    .replace(/\x1b\]8;;\x07/g, "")            // OSC 8 hyperlink end
    .replace(/\x1b\[[0-9;]*m/g, "");          // SGR color codes
}

function pad(n: number): string {
  return " ".repeat(n);
}

function hr(): string {
  return C.subtle("─".repeat(CONTENT_WIDTH));
}

function wrapCode(text: string, width: number): string[] {
  if (text === "") return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    out.push(text.slice(i, i + width));
  }
  return out.length ? out : [""];
}

function renderMarkdown(md: string, noColor: boolean): string[] {
  const lines: string[] = [];
  const rawLines = md.split("\n");

  let inCode = false;
  let codeBuffer: string[] = [];
  let codeLang = "";

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];

    // fenced code blocks
    if (raw.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeBuffer = [];
        codeLang = raw.replace("```", "").trim();
      } else {
        inCode = false;
        const lang = codeLang;
        lines.push("");
        lines.push(pad(2) + C.subtle("┌─ ") + C.muted(lang || "code") + C.subtle(" " + "─".repeat(Math.max(0, CONTENT_WIDTH - 4 - (lang || "code").length))));
        for (const cl of codeBuffer) {
          const wrapped = wrapCode(cl, CONTENT_WIDTH - 4);
          for (const wl of wrapped) {
            const padded = wl.padEnd(CONTENT_WIDTH - 4, " ");
            lines.push(pad(2) + C.subtle("│ ") + C.codeBlock(padded));
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
    if (raw.startsWith("###### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(7));
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.yellow.bold(l));
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("##### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(6));
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.cyan.bold(l));
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("#### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(5));
      for (const l of wrap(text, CONTENT_WIDTH)) {
        lines.push(pad(2) + C.green.bold(l));
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(4));
      const wrapped = wrap(text, CONTENT_WIDTH - 4);
      lines.push(pad(2) + C.cyan.bold("### ") + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(pad(6) + wrapped[j]);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("## ")) {
      lines.push("");
      const text = smartenInline(raw.slice(3));
      const wrapped = wrap(text, CONTENT_WIDTH - 4);
      lines.push(pad(2) + C.blue.bold("## ") + C.blue.bold(wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(pad(6) + wrapped[j]);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("# ")) {
      lines.push("");
      const text = smartenInline(raw.slice(2));
      const wrapped = wrap(text, CONTENT_WIDTH);
      for (const l of wrapped) {
        lines.push(pad(2) + C.purple.bold(l));
      }
      lines.push("");
      continue;
    }

    // blockquotes (group contiguous lines)
    if (/^\s*>/.test(raw)) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && /^\s*>/.test(rawLines[i])) {
        quoteLines.push(rawLines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      i--;
      lines.push("");
      for (const ql of quoteLines) {
        if (!ql.trim()) {
          lines.push(pad(2) + C.subtle("│ "));
          continue;
        }
        const styled = styleInline(smartenInline(ql), noColor);
        const wrapped = wrap(styled, CONTENT_WIDTH - 4);
        for (const wl of wrapped) {
          lines.push(pad(2) + C.subtle("│ ") + C.muted.italic(wl));
        }
      }
      lines.push("");
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
      const styled = styleInline(smartenInline(text), noColor);
      const firstPrefix = pad(2 + indent) + C.yellow("•") + " ";
      const bulletWidth = 2; // bullet + space
      const wrapped = wrap(styled, CONTENT_WIDTH - indent - bulletWidth);
      const extra = pad(2 + indent + bulletWidth);
      lines.push(firstPrefix + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(extra + wrapped[j]);
      }
      continue;
    }

    // ordered list
    if (/^\s*\d+\. /.test(raw)) {
      const indent = raw.match(/^(\s*)/)?.[1]?.length ?? 0;
      const num = raw.match(/^\s*(\d+)\./)?.[1] ?? "1";
      const text = raw.replace(/^\s*\d+\. /, "");
      const styled = styleInline(smartenInline(text), noColor);
      const bullet = `${num}.`;
      const bulletWidth = stripAnsi(bullet).length;
      const wrapped = wrap(styled, CONTENT_WIDTH - indent - bulletWidth - 1);
      lines.push(pad(2 + indent) + C.yellow(bullet) + " " + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(pad(2 + indent + bulletWidth + 1) + wrapped[j]);
      }
      continue;
    }

    // blank line
    if (!raw.trim()) {
      lines.push("");
      continue;
    }

    // normal paragraph
    const styled = styleInline(smartenInline(raw), noColor);
    const wrapped = wrap(styled, CONTENT_WIDTH);
    for (const l of wrapped) {
      lines.push(pad(2) + l);
    }
  }

  return lines;
}

function styleInline(text: string, noColor: boolean): string {
  if (noColor) {
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/[*_]/g, "");
  }

  // Phase 1: extract markdown links, replace with numbered placeholders
  interface LinkInfo { url: string; label: string; host: string }
  const linkInfos: LinkInfo[] = [];
  const withPlaceholders = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match: string, label: string, url: string) => {
      let host = url;
      try { host = new URL(url).hostname; } catch { /* keep raw */ }
      linkInfos.push({ url, label, host });
      return "@@" + (linkInfos.length - 1) + "@@";
    }
  );

  // Phase 2: apply all inline styles + bare URL wrapping
  const styled = withPlaceholders
    .replace(/~~(.+?)~~/g, (_, t) => C.muted.strikethrough(t))
    .replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => C.white.bold.italic(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => C.white.bold(t))
    .replace(/\*(.+?)\*/g, (_, t) => C.white.italic(t))
    .replace(/`([^`]+)`/g, (_, t) => C.subtle("`") + C.code(t) + C.subtle("`"))
    .replace(/https?:\/\/\S+/g, (u) => osc8(u, C.cyan.underline(u)))
    .replace(/[*_]/g, "");

  // Phase 3: replace placeholders with styled OSC 8 links
  return styled.replace(/@@(\d+)@@/g, (_match: string, idxStr: string) => {
    const info = linkInfos[parseInt(idxStr)];
    if (!info) return "";
    return osc8(info.url, C.cyan.underline(info.label)) + C.muted(" (" + info.host + ")");
  });
}

const tdService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
tdService.remove(["script", "style", "figure", "picture", "img", "iframe", "nav", "aside", "footer"]);

function renderLinks(links: Link[], noColor: boolean): { full: string[]; collapsed: string[] } {
  if (!links.length) return { full: [], collapsed: [] };

  const fullLines: string[] = [];
  fullLines.push("");
  fullLines.push(pad(2) + hr());
  fullLines.push("");
  const linksTitle = noColor ? "Links" : C.yellow.bold("Links");
  const linksCount = noColor ? ` (${links.length})` : C.muted(` (${links.length})`);
  fullLines.push(pad(2) + linksTitle + linksCount);
  fullLines.push("");

  // Group links by host
  const byHost = new Map<string, Link[]>();
  for (const link of links) {
    const arr = byHost.get(link.host) || [];
    arr.push(link);
    byHost.set(link.host, arr);
  }

  let idx = 1;
  for (const [host, hostLinks] of byHost) {
    fullLines.push(pad(2) + (noColor ? host : C.cyan(host)));
    for (const link of hostLinks) {
      const num = noColor ? `[${idx}]` : C.yellow(`[${idx}]`);
      const text = link.text.length > 60 ? link.text.slice(0, 57) + "..." : link.text;
      const wrapped = wrap(text, CONTENT_WIDTH - 10);
      fullLines.push(pad(4) + num + " " + (noColor ? (wrapped[0] || "") : C.white(wrapped[0] || "")));
      for (let j = 1; j < wrapped.length; j++) {
        fullLines.push(pad(8) + wrapped[j]);
      }
      const urlLine = noColor ? link.url : osc8(link.url, C.muted.underline(link.url));
      fullLines.push(pad(8) + urlLine);
      idx++;
    }
    fullLines.push("");
  }

  // Build collapsed version — show first 5 links, then a hint
  if (links.length <= 5) return { full: fullLines, collapsed: fullLines };

  const collapsedLines: string[] = [];
  collapsedLines.push("");
  collapsedLines.push(pad(2) + hr());
  collapsedLines.push("");
  collapsedLines.push(pad(2) + linksTitle + linksCount);
  collapsedLines.push("");

  idx = 1;
  let shown = 0;
  for (const [host, hostLinks] of byHost) {
    if (shown >= 5) break;
    collapsedLines.push(pad(2) + (noColor ? host : C.cyan(host)));
    for (const link of hostLinks) {
      if (shown >= 5) break;
      const num = noColor ? `[${idx}]` : C.yellow(`[${idx}]`);
      const text = link.text.length > 60 ? link.text.slice(0, 57) + "..." : link.text;
      const wrapped = wrap(text, CONTENT_WIDTH - 10);
      collapsedLines.push(pad(4) + num + " " + (noColor ? (wrapped[0] || "") : C.white(wrapped[0] || "")));
      for (let j = 1; j < wrapped.length; j++) {
        collapsedLines.push(pad(8) + wrapped[j]);
      }
      const urlLine = noColor ? link.url : osc8(link.url, C.muted.underline(link.url));
      collapsedLines.push(pad(8) + urlLine);
      idx++;
      shown++;
    }
    collapsedLines.push("");
  }

  const remaining = links.length - shown;
  if (noColor) {
    collapsedLines.push(pad(2) + `  ${remaining} more  ·  press e to expand`);
  } else {
    collapsedLines.push(pad(2) + C.subtle(`  ${remaining} more  ·  press `) + C.yellow("e") + C.subtle(" to expand"));
  }
  collapsedLines.push("");

  return { full: fullLines, collapsed: collapsedLines };
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
    const accent = siteAccentColor(article.url, article.themeColor);
    const site = article.siteName.toUpperCase();
    lines.push(pad(2) + accent("▍ ") + accent(site));
    lines.push("");
  }

  // ── Title
  const titleLines = wrap(smartenText(article.title), CONTENT_WIDTH);
  for (const l of titleLines) {
    lines.push(pad(2) + C.purple.bold(l));
  }
  lines.push("");

  // ── Meta line
  const metaParts: string[] = [];
  if (article.byline) metaParts.push(C.cyan(smartenText(article.byline)));
  if (article.publishedTime) metaParts.push(C.muted(article.publishedTime));
  metaParts.push(C.green(`~${article.readingTime} min read`));
  metaParts.push(C.muted(`${article.wordCount.toLocaleString()} words`));
  const metaLine = noColor
    ? metaParts.map(stripAnsi).join("  ·  ")
    : metaParts.join(C.subtle("  ·  "));
  lines.push(pad(2) + metaLine);

  // ── Tags
  if (article.tags.length) {
    const tagStr = article.tags
      .map((t) => {
        if (noColor) return `[${t}]`;
        const pill = chalk.bgHex("#313244").hex("#89b4fa")(" " + t + " ");
        return pill;
      })
      .join(" ");
    lines.push(pad(2) + tagStr);
  }

  lines.push("");
  lines.push(pad(2) + hr());
  lines.push("");

  // ── Body
  const cleanContent = article.content.replace(/<img\b[^>]*>/gi, "");
  const markdown = tdService.turndown(cleanContent);
  const bodyLines = renderMarkdown(markdown, noColor);
  for (const l of bodyLines) {
    lines.push(l);
  }

  // ── Links section
  const { full: linksFull, collapsed: linksCollapsed } = renderLinks(article.links, noColor);
  const linksStart = linksFull.length ? lines.length : -1;
  for (const l of linksCollapsed) {
    lines.push(l);
  }

  // ── Footer
  lines.push("");
  lines.push(pad(2) + hr());
  lines.push("");
  const sourceLabel = noColor ? "source: " : C.muted("source: ");
  const sourceUrl = noColor ? article.url : osc8(article.url, C.cyan.underline(article.url));
  lines.push(pad(2) + sourceLabel + sourceUrl);
  lines.push("");

  // ── Page breaks (every ~terminal-height lines)
  const pageHeight = (process.stdout.rows || 40) - 5;
  const pageBreaks: number[] = [0];
  for (let i = pageHeight; i < lines.length; i += pageHeight) {
    pageBreaks.push(i);
  }

  // ── Plain text version
  const plain = lines.map(stripAnsi).join("\n");

  return { lines, plain, pageBreaks, linksStart, linksFull, linksCollapsed };
}
