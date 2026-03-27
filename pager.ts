import type { RenderedArticle } from "./renderer";
import type { Article } from "./fetcher";
import chalk from "chalk";

const C = {
  green:  chalk.hex("#a6e3a1"),
  blue:   chalk.hex("#89b4fa"),
  muted:  chalk.hex("#6c7086"),
  subtle: chalk.hex("#45475a"),
  yellow: chalk.hex("#f9e2af"),
  cyan:   chalk.hex("#89dceb"),
};

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07|\x1b\]8;;\x07/g;

function getTermSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 40,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function renderStatusBar(
  article: Article,
  topLine: number,
  totalLines: number,
  searching: boolean,
  searchTerm: string,
  hasLinks: boolean,
  linksExpanded: boolean,
  matchIdx: number,
  matchTotal: number
) {
  const { cols } = getTermSize();
  const pct = Math.round((topLine / Math.max(1, totalLines - 1)) * 100);
  const domain = (() => {
    try { return new URL(article.url).hostname; } catch { return article.url; }
  })();

  const matchInfo = searchTerm && matchTotal > 0
    ? C.yellow(` ${matchIdx}/${matchTotal}`)
    : searchTerm && !searching
    ? C.subtle(" no matches")
    : "";

  const left = searching
    ? C.yellow(" / ") + C.muted(searchTerm) + C.subtle("_") + matchInfo
    : C.subtle(" ") + C.muted(domain) + matchInfo;

  const mid = C.subtle(article.siteName || "");

  const right = C.subtle(`${pct}% `) +
    C.green("●") + C.subtle(` ln ${topLine + 1}/${totalLines} `);

  const nav = searching
    ? C.muted(" enter") + C.subtle(":search ") + C.muted("esc") + C.subtle(":cancel ")
    : C.muted(" j/k") + C.subtle(":scroll ") +
      C.muted("d/u") + C.subtle(":page ") +
      C.muted("/") + C.subtle(":search ") +
      (hasLinks ? C.muted("e") + C.subtle(":links ") : "") +
      C.muted("o") + C.subtle(":open ") +
      C.muted("q") + C.subtle(":quit");

  const leftStr  = stripAnsi(left);
  const midStr   = stripAnsi(mid);
  const rightStr = stripAnsi(right);
  const navStr   = stripAnsi(nav);

  const totalVisible = leftStr.length + midStr.length + rightStr.length + navStr.length;
  const spaces = Math.max(0, cols - totalVisible);
  const leftPad = Math.floor(spaces / 3);
  const rightPad = spaces - leftPad - Math.floor(spaces / 3);

  process.stdout.write(
    "\x1b[" + (getTermSize().rows) + ";1H" + // move to last row
    "\x1b[48;2;42;43;47m" +                   // bg #2a2b2f
    left +
    " ".repeat(leftPad) +
    mid +
    " ".repeat(Math.floor(spaces / 3)) +
    right +
    " ".repeat(Math.max(0, rightPad - navStr.length)) +
    nav +
    "\x1b[0m" +
    "\x1b[K"
  );
}

function stripAnsi(s: string) {
  return s.replace(ANSI_RE, "");
}

function highlightMatchRange(line: string, start: number, end: number): string {
  const tokens: Array<{ text: string; visible: boolean }> = [];
  let last = 0;
  for (const match of line.matchAll(ANSI_RE)) {
    const idx = match.index ?? 0;
    if (idx > last) {
      tokens.push({ text: line.slice(last, idx), visible: true });
    }
    tokens.push({ text: match[0], visible: false });
    last = idx + match[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), visible: true });

  const hl = chalk.bgHex("#f9e2af").hex("#1a1b1e");
  let out = "";
  let visibleIdx = 0;

  for (const token of tokens) {
    if (!token.visible) {
      out += token.text;
      continue;
    }

    const segStart = visibleIdx;
    const segEnd = segStart + token.text.length;
    if (end <= segStart || start >= segEnd) {
      out += token.text;
    } else {
      const localStart = Math.max(start, segStart) - segStart;
      const localEnd = Math.min(end, segEnd) - segStart;
      out += token.text.slice(0, localStart);
      out += hl(token.text.slice(localStart, localEnd));
      out += token.text.slice(localEnd);
    }
    visibleIdx = segEnd;
  }

  return out;
}

interface MatchPos {
  line: number;
  start: number;
  end: number;
}

function findMatches(lines: string[], term: string): MatchPos[] {
  if (!term) return [];
  const out: MatchPos[] = [];
  const reSrc = escapeRe(term);
  for (let i = 0; i < lines.length; i++) {
    const plain = stripAnsi(lines[i]);
    const re = new RegExp(reSrc, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(plain)) !== null) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      out.push({ line: i, start, end });
      if (re.lastIndex === start) re.lastIndex++;
    }
  }
  return out;
}

function findNextMatchIndex(matches: MatchPos[], fromLine: number, fromStart: number): number {
  if (!matches.length) return -1;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.line > fromLine) return i;
    if (m.line === fromLine && m.start > fromStart) return i;
  }
  return 0; // wrap
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() { process.stdout.write("\x1b[?25l"); }
function showCursor() { process.stdout.write("\x1b[?25h"); }
function enterAltScreen() { process.stdout.write("\x1b[?1049h"); }
function exitAltScreen() { process.stdout.write("\x1b[?1049l"); }

function renderPage(
  lines: string[],
  topLine: number,
  article: Article,
  searching: boolean,
  searchTerm: string,
  highlightLine: number,
  highlightRange: { start: number; end: number } | null,
  hasLinks: boolean,
  linksExpanded: boolean,
  matchIdx: number,
  matchTotal: number
) {
  const { rows } = getTermSize();
  const viewHeight = rows - 1;
  clearScreen();

  const visible = lines.slice(topLine, topLine + viewHeight);
  for (let i = 0; i < viewHeight; i++) {
    const l = visible[i] ?? "";
    const absLine = topLine + i;

    if (highlightLine === absLine && searchTerm && highlightRange) {
      const highlighted = highlightMatchRange(l, highlightRange.start, highlightRange.end);
      process.stdout.write(highlighted + "\n");
    } else {
      process.stdout.write(l + "\n");
    }
  }

  renderStatusBar(article, topLine, lines.length, searching, searchTerm, hasLinks, linksExpanded, matchIdx, matchTotal);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function startPager(
  rendered: RenderedArticle,
  article: Article
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(rendered.plain);
    return;
  }

  const { lines: initialLines } = rendered;
  let lines = [...initialLines];
  let topLine = 0;
  let searching = false;
  let searchTerm = "";
  let highlightLine = -1;
  let highlightRange: { start: number; end: number } | null = null;
  let linksExpanded = false;
  let matchIdx = 0;
  let matchTotal = 0;
  let matchPos = -1;
  let matches: MatchPos[] = [];
  const hasLinks = rendered.linksStart >= 0 && rendered.linksFull.length > 0;

  enterAltScreen();
  hideCursor();

  const cleanup = () => {
    showCursor();
    exitAltScreen();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  renderPage(lines, topLine, article, searching, searchTerm, highlightLine, highlightRange, hasLinks, linksExpanded, matchIdx, matchTotal);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const { rows } = getTermSize();
  const viewHeight = rows - 1;
  const maxTop = Math.max(0, lines.length - viewHeight);

  process.stdin.on("data", (key: string) => {
    const { rows } = getTermSize();
    const viewH = rows - 1;
    const maxT = Math.max(0, lines.length - viewH);

    if (searching) {
      if (key === "\r" || key === "\n") {
        // confirm search
        matches = findMatches(lines, searchTerm);
        matchTotal = matches.length;
        if (matchTotal > 0) {
          matchPos = findNextMatchIndex(matches, topLine - 1, -1);
          const m = matches[matchPos];
          highlightLine = m.line;
          highlightRange = { start: m.start, end: m.end };
          matchIdx = matchPos + 1;
          topLine = clamp(m.line, 0, maxT);
        } else {
          matchPos = -1;
          matchIdx = 0;
          highlightLine = -1;
          highlightRange = null;
        }
        searching = false;
      } else if (key === "\x1b" || key === "\x03") {
        searching = false;
        searchTerm = "";
        highlightLine = -1;
        highlightRange = null;
        matchIdx = 0;
        matchTotal = 0;
        matchPos = -1;
        matches = [];
      } else if (key === "\x7f") {
        searchTerm = searchTerm.slice(0, -1);
      } else if (key.charCodeAt(0) >= 32) {
        searchTerm += key;
      }

      renderPage(lines, topLine, article, searching, searchTerm, highlightLine, highlightRange, hasLinks, linksExpanded, matchIdx, matchTotal);
      return;
    }

    switch (key) {
      case "q":
      case "Q":
      case "\x03":
        cleanup();
        break;

      // scroll down
      case "j":
      case "\x1b[B": // arrow down
        topLine = clamp(topLine + 1, 0, maxT);
        break;

      // scroll up
      case "k":
      case "\x1b[A": // arrow up
        topLine = clamp(topLine - 1, 0, maxT);
        break;

      // half page down
      case "d":
        topLine = clamp(topLine + Math.floor(viewH / 2), 0, maxT);
        break;

      // half page up
      case "u":
        topLine = clamp(topLine - Math.floor(viewH / 2), 0, maxT);
        break;

      // full page down
      case " ":
      case "f":
        topLine = clamp(topLine + viewH, 0, maxT);
        break;

      // full page up
      case "b":
        topLine = clamp(topLine - viewH, 0, maxT);
        break;

      // go to top
      case "g":
        topLine = 0;
        break;

      // go to bottom
      case "G":
        topLine = maxT;
        break;

      // search
      case "/":
        searching = true;
        searchTerm = "";
        matchIdx = 0;
        matchTotal = 0;
        matchPos = -1;
        matches = [];
        highlightLine = -1;
        highlightRange = null;
        break;

      // next search result
      case "n":
        if (searchTerm && matches.length) {
          matchPos = (matchPos + 1) % matches.length;
          const m = matches[matchPos];
          highlightLine = m.line;
          highlightRange = { start: m.start, end: m.end };
          matchIdx = matchPos + 1;
          topLine = clamp(m.line, 0, maxT);
        }
        break;

      // open in browser
      case "o": {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
            ? "start"
            : "xdg-open";
        Bun.spawn([opener, article.url]);
        break;
      }

      // resize
      case "\x1b[8~":
        break;

      // expand/collapse links
      case "e":
        if (rendered.linksStart >= 0 && rendered.linksFull.length > 0) {
          linksExpanded = !linksExpanded;
          const newLinkLines = linksExpanded ? rendered.linksFull : rendered.linksCollapsed;
          const oldLinkLines = linksExpanded ? rendered.linksCollapsed : rendered.linksFull;
          const afterLinks = rendered.linksStart + oldLinkLines.length;
          lines = [
            ...lines.slice(0, rendered.linksStart),
            ...newLinkLines,
            ...lines.slice(afterLinks),
          ];
          if (searchTerm) {
            matches = findMatches(lines, searchTerm);
            matchTotal = matches.length;
            if (matchTotal > 0) {
              const fromLine = highlightLine >= 0 ? highlightLine : topLine - 1;
              const fromStart = highlightRange ? highlightRange.start : -1;
              matchPos = findNextMatchIndex(matches, fromLine, fromStart);
              const m = matches[matchPos];
              highlightLine = m.line;
              highlightRange = { start: m.start, end: m.end };
              matchIdx = matchPos + 1;
            } else {
              matchPos = -1;
              matchIdx = 0;
              highlightLine = -1;
              highlightRange = null;
            }
          }
        }
        break;
    }

    renderPage(lines, topLine, article, searching, searchTerm, highlightLine, highlightRange, hasLinks, linksExpanded, matchIdx, matchTotal);
  });

  // keep alive
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
  });
}
