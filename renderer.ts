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

interface RenderViewport {
  cols: number;
  rows: number;
}

interface RenderLayout {
  cols: number;
  rows: number;
  columnWidth: number;
  contentWidth: number;
  outerPad: number;
  baseIndent: number;
  pageHeight: number;
}

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

interface InlineSpan {
  text: string;
  kind: "plain" | "link" | "url" | "code" | "bold" | "italic" | "boldItalic" | "strike" | "muted";
  href?: string;
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

function typographicStyle(text: string, noColor: boolean): string {
  if (noColor) return text
    .replace(/—/g, "--")
    .replace(/…/g, "...")
    .replace(/[""]/g, "\"")
    .replace(/['']/g, "'");
  const ansiPart = "(?:\\x1b\\[[0-9;]*m|\\x1b\\]8;;[^\\x07]*\\x07|\\x1b\\]8;;\\x07)";
  const dblCurlyRe = new RegExp(`“(?:${ansiPart}|[^”])*”`, "g");
  const dblStraightRe = new RegExp(`\"(?:${ansiPart}|[^\"])*\"`, "g");
  const placeholders: string[] = [];
  const withCurly = text.replace(dblCurlyRe, (m) => {
    const styled = applyBaseStyle(m, C.muted);
    const token = `~~TERMREAD_QUOTE_${placeholders.length}~~`;
    placeholders.push(styled);
    return token;
  });
  const withBoth = withCurly.replace(dblStraightRe, (m) => {
    const styled = applyBaseStyle(m, C.muted);
    const token = `~~TERMREAD_QUOTE_${placeholders.length}~~`;
    placeholders.push(styled);
    return token;
  });
  const withLooseQuotes = withBoth
    .replace(/[“”]/g, (q) => C.muted(q))
    .replace(/"/g, (q) => C.muted(q));
  return withLooseQuotes.replace(/~~TERMREAD_QUOTE_(\d+)~~/g, (_m, idx) => {
    const pick = placeholders[parseInt(idx)];
    return pick ?? "";
  });
}

function applyBaseStyle(text: string, style: (s: string) => string): string {
  const sentinel = "__STYLE__";
  const styled = style(sentinel);
  const idx = styled.indexOf(sentinel);
  if (idx === -1) return text;
  const open = styled.slice(0, idx);
  const close = styled.slice(idx + sentinel.length);
  const resetRe = /\x1b\[(0|39|49|22|23|24|27|28|29)m/g;
  return open + text.replace(resetRe, (m) => m + open) + close;
}

function styleSpanText(text: string, noColor: boolean): string {
  return typographicStyle(text, noColor);
}

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|~~(.+?)~~|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|(https?:\/\/\S+)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const idx = match.index ?? 0;
    if (idx > last) {
      spans.push({ text: text.slice(last, idx), kind: "plain" });
    }

    if (match[1] && match[2]) {
      let host = match[2];
      try { host = new URL(match[2]).hostname; } catch { /* keep raw */ }
      spans.push({ text: match[1], kind: "link", href: match[2] });
      spans.push({ text: ` (${host})`, kind: "muted" });
    } else if (match[3]) {
      spans.push({ text: match[3], kind: "code" });
    } else if (match[4]) {
      spans.push({ text: match[4], kind: "strike" });
    } else if (match[5]) {
      spans.push({ text: match[5], kind: "boldItalic" });
    } else if (match[6]) {
      spans.push({ text: match[6], kind: "bold" });
    } else if (match[7]) {
      spans.push({ text: match[7], kind: "italic" });
    } else if (match[8]) {
      spans.push({ text: match[8], kind: "url", href: match[8] });
    }

    last = idx + match[0].length;
  }

  if (last < text.length) {
    spans.push({ text: text.slice(last), kind: "plain" });
  }

  return spans;
}

function splitSpanWords(span: InlineSpan): InlineSpan[] {
  const parts = span.text.match(/\s+|[^\s]+/g) ?? [span.text];
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({ ...span, text: part }));
}

function splitSpanChunk(span: InlineSpan, width: number): InlineSpan[] {
  if (width <= 0) return [{ ...span }];
  const out: InlineSpan[] = [];
  for (let i = 0; i < span.text.length; i += width) {
    out.push({ ...span, text: span.text.slice(i, i + width) });
  }
  return out.length ? out : [{ ...span }];
}

function wrapInline(spans: InlineSpan[], width: number): InlineSpan[][] {
  if (width <= 0) {
    return spans.length ? [spans.map((span) => ({ ...span }))] : [[]];
  }

  const tokens = spans.flatMap(splitSpanWords);
  const lines: InlineSpan[][] = [];
  let line: InlineSpan[] = [];
  let lineWidth = 0;

  const pushLine = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
  };

  const appendToken = (token: InlineSpan) => {
    const tokenWidth = token.text.length;
    if (/^\s+$/.test(token.text) && lineWidth === 0) return;

    if (tokenWidth > width && !/^\s+$/.test(token.text)) {
      if (lineWidth > 0) pushLine();
      const chunks = splitSpanChunk(token, width);
      for (let i = 0; i < chunks.length; i++) {
        line.push(chunks[i]);
        lineWidth += chunks[i].text.length;
        if (i < chunks.length - 1) pushLine();
      }
      return;
    }

    if (lineWidth + tokenWidth > width) {
      if (lineWidth > 0) pushLine();
      if (/^\s+$/.test(token.text)) return;
    }

    line.push(token);
    lineWidth += tokenWidth;
  };

  for (const token of tokens) {
    appendToken(token);
  }

  if (line.length || !lines.length) {
    lines.push(line);
  }

  return lines;
}

function renderInlineSpan(span: InlineSpan, noColor: boolean): string {
  if (noColor) return styleSpanText(span.text, true);

  switch (span.kind) {
    case "plain":
      return styleSpanText(span.text, false);
    case "muted":
      return C.muted(styleSpanText(span.text, false));
    case "link":
    case "url":
      return osc8(span.href || span.text, C.cyan.underline(span.text));
    case "code":
      return C.subtle("`") + C.code(span.text) + C.subtle("`");
    case "bold":
      return C.white.bold(styleSpanText(span.text, false));
    case "italic":
      return C.white.italic(styleSpanText(span.text, false));
    case "boldItalic":
      return C.white.bold.italic(styleSpanText(span.text, false));
    case "strike":
      return C.red.strikethrough(styleSpanText(span.text, false));
  }
}

function mergeInlineSpans(spans: InlineSpan[]): InlineSpan[] {
  const merged: InlineSpan[] = [];

  for (const span of spans) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === span.kind && prev.href === span.href) {
      prev.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function renderInlineLine(spans: InlineSpan[], noColor: boolean): string {
  return mergeInlineSpans(spans)
    .map((span) => renderInlineSpan(span, noColor))
    .join("");
}

function renderWrappedInline(text: string, width: number, noColor: boolean): string[] {
  const spans = parseInline(text);
  const lines = wrapInline(spans, width);
  return lines.map((line) => renderInlineLine(line, noColor));
}

function pad(n: number): string {
  return " ".repeat(n);
}

function getViewport(viewport: Partial<RenderViewport> = {}): RenderViewport {
  return {
    cols: viewport.cols ?? process.stdout.columns ?? 80,
    rows: viewport.rows ?? process.stdout.rows ?? 40,
  };
}

function getLayout(viewport: Partial<RenderViewport> = {}): RenderLayout {
  const { cols, rows } = getViewport(viewport);
  const columnWidth = Math.min(cols, 88);
  const outerPad = Math.max(0, Math.floor((cols - columnWidth) / 2));
  return {
    cols,
    rows,
    columnWidth,
    contentWidth: columnWidth - 4,
    outerPad,
    baseIndent: outerPad + 2,
    pageHeight: rows - 5,
  };
}

function indent(layout: RenderLayout, extra: number = 0): string {
  return pad(layout.baseIndent + extra);
}

function compactNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function hr(layout: RenderLayout): string {
  return C.subtle("─".repeat(layout.contentWidth));
}

function wrapCode(text: string, width: number): string[] {
  if (text === "") return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) {
    out.push(text.slice(i, i + width));
  }
  return out.length ? out : [""];
}

function renderMarkdown(md: string, noColor: boolean, layout: RenderLayout): string[] {
  const lines: string[] = [];
  const rawLines = md.split("\n");

  let inCode = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let firstParagraph = true;

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
        lines.push(indent(layout) + C.subtle("┌─ ") + C.muted(lang || "code") + C.subtle(" " + "─".repeat(Math.max(0, layout.contentWidth - 4 - (lang || "code").length))));
        for (const cl of codeBuffer) {
          const wrapped = wrapCode(cl, layout.contentWidth - 4);
          for (const wl of wrapped) {
            const padded = wl.padEnd(layout.contentWidth - 4, " ");
            lines.push(indent(layout) + C.subtle("│ ") + C.codeBlock(padded));
          }
        }
        lines.push(indent(layout) + C.subtle("└" + "─".repeat(layout.contentWidth - 2)));
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
      const wrapped = renderWrappedInline(text, layout.contentWidth, noColor);
      for (const l of wrapped) {
        const colored = noColor ? l : applyBaseStyle(l, C.yellow.bold);
        lines.push(indent(layout) + colored);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("##### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(6));
      const wrapped = renderWrappedInline(text, layout.contentWidth, noColor);
      for (const l of wrapped) {
        const colored = noColor ? l : applyBaseStyle(l, C.cyan.bold);
        lines.push(indent(layout) + colored);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("#### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(5));
      const wrapped = renderWrappedInline(text, layout.contentWidth, noColor);
      for (const l of wrapped) {
        const colored = noColor ? l : applyBaseStyle(l, C.green.bold);
        lines.push(indent(layout) + colored);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("### ")) {
      lines.push("");
      const text = smartenInline(raw.slice(4));
      const wrapped = renderWrappedInline(text, layout.contentWidth - 4, noColor);
      const prefix = noColor ? "### " : C.cyan.bold("### ");
      const first = wrapped[0] || "";
      const firstColored = noColor ? first : applyBaseStyle(first, C.cyan.bold);
      lines.push(indent(layout) + prefix + firstColored);
      for (let j = 1; j < wrapped.length; j++) {
        const colored = noColor ? wrapped[j] : applyBaseStyle(wrapped[j], C.cyan.bold);
        lines.push(indent(layout, 4) + colored);
      }
      lines.push("");
      continue;
    }
    if (raw.startsWith("## ")) {
      lines.push("");
      const text = smartenInline(raw.slice(3));
      const wrapped = renderWrappedInline(text, layout.contentWidth - 4, noColor);
      const prefix = noColor ? "## " : C.blue.bold("## ");
      const first = wrapped[0] || "";
      const firstColored = noColor ? first : applyBaseStyle(first, C.blue.bold);
      lines.push(indent(layout) + prefix + firstColored);
      for (let j = 1; j < wrapped.length; j++) {
        const colored = noColor ? wrapped[j] : applyBaseStyle(wrapped[j], C.blue.bold);
        lines.push(indent(layout, 4) + colored);
      }
      const underlineLen = Math.min(layout.contentWidth, stripAnsi(first || text).length + 3);
      lines.push(indent(layout) + (noColor ? "─".repeat(underlineLen) : C.subtle("─".repeat(underlineLen))));
      lines.push("");
      continue;
    }
    if (raw.startsWith("# ")) {
      lines.push("");
      const text = smartenInline(raw.slice(2));
      const wrapped = renderWrappedInline(text, layout.contentWidth, noColor);
      for (const l of wrapped) {
        const colored = noColor ? l : applyBaseStyle(l, C.purple.bold);
        lines.push(indent(layout) + colored);
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
      const innerWidth = layout.contentWidth - 4;
      const frameLeft = noColor ? "│ " : C.green("│ ");
      const frameRight = noColor ? " │" : C.green(" │");
      for (const ql of quoteLines) {
        if (!ql.trim()) {
          const blank = pad(innerWidth);
          const coloredBlank = noColor ? blank : applyBaseStyle(blank, C.muted);
          lines.push(indent(layout) + frameLeft + coloredBlank + frameRight);
          continue;
        }
        const smartened = smartenInline(ql);
        const wrapped = renderWrappedInline(smartened, innerWidth, noColor);
        for (const wl of wrapped) {
          const visLen = stripAnsi(wl).length;
          const padding = " ".repeat(Math.max(0, innerWidth - visLen));
          const content = wl + padding;
          const colored = noColor ? content : applyBaseStyle(content, C.muted);
          lines.push(indent(layout) + frameLeft + colored + frameRight);
        }
      }
      lines.push("");
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(raw.trim()) || /^\*\*\*+$/.test(raw.trim())) {
      lines.push("");
      lines.push(indent(layout) + hr(layout));
      lines.push("");
      continue;
    }

    // unordered list
    if (/^\s*[-*+] /.test(raw)) {
      const listIndent = raw.match(/^(\s*)/)?.[1]?.length ?? 0;
      const text = raw.replace(/^\s*[-*+] /, "");
      const bullet = noColor ? "•" : C.yellow("•");
      const bulletWidth = 2; // bullet + space
      const wrapped = renderWrappedInline(smartenInline(text), layout.contentWidth - listIndent - bulletWidth, noColor);
      const firstPrefix = indent(layout, listIndent) + bullet + " ";
      const extra = indent(layout, listIndent + bulletWidth);
      lines.push(firstPrefix + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(extra + wrapped[j]);
      }
      continue;
    }

    // ordered list
    if (/^\s*\d+\. /.test(raw)) {
      const listIndent = raw.match(/^(\s*)/)?.[1]?.length ?? 0;
      const num = raw.match(/^\s*(\d+)\./)?.[1] ?? "1";
      const text = raw.replace(/^\s*\d+\. /, "");
      const bullet = `${num}.`;
      const bulletLabel = noColor ? bullet : C.yellow(bullet);
      const bulletWidth = stripAnsi(bullet).length;
      const wrapped = renderWrappedInline(smartenInline(text), layout.contentWidth - listIndent - bulletWidth - 1, noColor);
      lines.push(indent(layout, listIndent) + bulletLabel + " " + (wrapped[0] || ""));
      for (let j = 1; j < wrapped.length; j++) {
        lines.push(indent(layout, listIndent + bulletWidth + 1) + wrapped[j]);
      }
      continue;
    }

    // blank line
    if (!raw.trim()) {
      lines.push("");
      continue;
    }

    // normal paragraph
    const inlineText = smartenInline(raw);
    if (firstParagraph) {
      const wrapped = renderWrappedInline(inlineText, layout.contentWidth - 2, noColor);
      for (let j = 0; j < wrapped.length; j++) {
        lines.push(indent(layout) + (j === 0 ? "    " : "") + wrapped[j]);
      }
      firstParagraph = false;
    } else {
      const wrapped = renderWrappedInline(inlineText, layout.contentWidth, noColor);
      for (const l of wrapped) {
        lines.push(indent(layout) + l);
      }
    }
  }

  return lines;
}

const tdService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
tdService.remove(["script", "style", "figure", "picture", "img", "iframe", "nav", "aside", "footer"]);

function renderLinks(links: Link[], noColor: boolean, layout: RenderLayout): { full: string[]; collapsed: string[] } {
  if (!links.length) return { full: [], collapsed: [] };

  const fullLines: string[] = [];
  fullLines.push("");
  fullLines.push(indent(layout) + hr(layout));
  fullLines.push("");
  const linksTitle = noColor ? "Links" : C.yellow.bold("Links");
  const linksCount = noColor ? ` (${links.length})` : C.muted(` (${links.length})`);
  fullLines.push(indent(layout) + linksTitle + linksCount);
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
    fullLines.push(indent(layout) + (noColor ? host : C.cyan(host)));
    for (const link of hostLinks) {
      const num = noColor ? `[${idx}]` : C.yellow(`[${idx}]`);
      const text = link.text.length > 60 ? link.text.slice(0, 57) + "..." : link.text;
      const wrapped = wrap(text, layout.contentWidth - 10);
      fullLines.push(indent(layout, 2) + num + " " + (noColor ? (wrapped[0] || "") : C.white(wrapped[0] || "")));
      for (let j = 1; j < wrapped.length; j++) {
        fullLines.push(indent(layout, 6) + wrapped[j]);
      }
      const urlLine = noColor ? link.url : osc8(link.url, C.muted.underline(link.url));
      fullLines.push(indent(layout, 6) + urlLine);
      idx++;
    }
    fullLines.push("");
  }

  // Build collapsed version — show first 5 links, then a hint
  if (links.length <= 5) return { full: fullLines, collapsed: fullLines };

  const collapsedLines: string[] = [];
  collapsedLines.push("");
  collapsedLines.push(indent(layout) + hr(layout));
  collapsedLines.push("");
  collapsedLines.push(indent(layout) + linksTitle + linksCount);
  collapsedLines.push("");

  idx = 1;
  let shown = 0;
  for (const [host, hostLinks] of byHost) {
    if (shown >= 5) break;
    collapsedLines.push(indent(layout) + (noColor ? host : C.cyan(host)));
    for (const link of hostLinks) {
      if (shown >= 5) break;
      const num = noColor ? `[${idx}]` : C.yellow(`[${idx}]`);
      const text = link.text.length > 60 ? link.text.slice(0, 57) + "..." : link.text;
      const wrapped = wrap(text, layout.contentWidth - 10);
      collapsedLines.push(indent(layout, 2) + num + " " + (noColor ? (wrapped[0] || "") : C.white(wrapped[0] || "")));
      for (let j = 1; j < wrapped.length; j++) {
        collapsedLines.push(indent(layout, 6) + wrapped[j]);
      }
      const urlLine = noColor ? link.url : osc8(link.url, C.muted.underline(link.url));
      collapsedLines.push(indent(layout, 6) + urlLine);
      idx++;
      shown++;
    }
    collapsedLines.push("");
  }

  const remaining = links.length - shown;
  if (noColor) {
    collapsedLines.push(indent(layout) + `  ${remaining} more  ·  press e to expand`);
  } else {
    collapsedLines.push(indent(layout) + C.subtle(`  ${remaining} more  ·  press `) + C.yellow("e") + C.subtle(" to expand"));
  }
  collapsedLines.push("");

  return { full: fullLines, collapsed: collapsedLines };
}

function stripOuterPad(line: string, outerPad: number): string {
  let trimmed = line;
  let remaining = outerPad;
  while (remaining > 0 && trimmed.startsWith(" ")) {
    trimmed = trimmed.slice(1);
    remaining--;
  }
  return trimmed;
}

export function renderArticle(
  article: Article,
  opts: {
    noColor?: boolean;
    viewport?: { cols?: number; rows?: number };
  } = {}
): RenderedArticle {
  const noColor = opts.noColor ?? false;
  const layout = getLayout(opts.viewport);
  const lines: string[] = [];

  // ── Top spacer
  lines.push("");

  const accent = siteAccentColor(article.url, article.themeColor);

  // ── Site name
  if (article.siteName) {
    const site = article.siteName.toUpperCase();
    lines.push(indent(layout) + accent("▍ ") + accent(site));
    lines.push("");
  }

  // ── Title
  const titleLines = wrap(smartenText(article.title), layout.contentWidth);
  lines.push(indent(layout) + accent("┈".repeat(Math.min(layout.contentWidth, 40))));
  for (const l of titleLines) {
    lines.push(indent(layout) + C.purple.bold(l));
  }
  lines.push("");

  // ── Meta line
  const metaParts: string[] = [];
  if (article.byline) metaParts.push(C.cyan(smartenText(article.byline)));
  if (article.publishedTime) metaParts.push(C.muted(article.publishedTime));
  metaParts.push(C.green(`~${article.readingTime} min read`));
  metaParts.push(C.muted(`${compactNum(article.wordCount)} words`));
  const metaLine = noColor
    ? metaParts.map(stripAnsi).join("  ·  ")
    : metaParts.join(C.subtle("  ·  "));
  lines.push(indent(layout) + metaLine);

  // ── Tags
  if (article.tags.length) {
    const tagStr = article.tags
      .map((t) => {
        if (noColor) return `[${t}]`;
        return C.subtle("[") + C.blue(" " + t + " ") + C.subtle("]");
      })
      .join("  ");
    lines.push(indent(layout) + tagStr);
  }

  lines.push("");
  lines.push(indent(layout) + hr(layout));
  lines.push("");

  // ── Body
  const cleanContent = article.content.replace(/<img\b[^>]*>/gi, "");
  const markdown = tdService.turndown(cleanContent);
  const bodyLines = renderMarkdown(markdown, noColor, layout);
  for (const l of bodyLines) {
    lines.push(l);
  }

  // ── Article end marker
  lines.push("");
  lines.push(indent(layout) + C.subtle("╌ ╌ ╌"));
  lines.push("");

  // ── Links section
  const { full: linksFull, collapsed: linksCollapsed } = renderLinks(article.links, noColor, layout);
  const linksStart = linksFull.length ? lines.length : -1;
  for (const l of linksCollapsed) {
    lines.push(l);
  }

  // ── Footer
  lines.push("");
  if (noColor) {
    lines.push(indent(layout) + "· · · · · · · · · ·");
  } else {
    const dots = C.text("·") + " " + C.white("·") + " " + C.muted("·") + " " + C.subtle("·") + " " + C.subtle(" ·  ·  ·  ·  ·");
    lines.push(indent(layout) + dots);
  }
  lines.push("");
  const sourceLabel = noColor ? "source: " : C.muted("source: ");
  const sourceUrl = noColor ? article.url : osc8(article.url, C.cyan.underline(article.url));
  lines.push(indent(layout) + sourceLabel + sourceUrl);
  lines.push("");

  // ── Page breaks (every ~terminal-height lines)
  const pageBreaks: number[] = [0];
  for (let i = layout.pageHeight; i < lines.length; i += layout.pageHeight) {
    pageBreaks.push(i);
  }

  // ── Plain text version
  const plain = lines
    .map((line) => stripOuterPad(stripAnsi(line), layout.outerPad))
    .join("\n")
    .replace(/—/g, "--")
    .replace(/…/g, "...")
    .replace(/[""]/g, "\"")
    .replace(/['']/g, "'");

  return { lines, plain, pageBreaks, linksStart, linksFull, linksCollapsed };
}
