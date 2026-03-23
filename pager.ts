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
  linksExpanded: boolean
) {
  const { cols } = getTermSize();
  const pct = Math.round((topLine / Math.max(1, totalLines - 1)) * 100);
  const domain = (() => {
    try { return new URL(article.url).hostname; } catch { return article.url; }
  })();

  const left = searching
    ? C.yellow(" / ") + C.muted(searchTerm) + C.subtle("_")
    : C.subtle(" ") + C.muted(domain);

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
  return s.replace(/\x1b\[[0-9;]*m/g, "");
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
  hasLinks: boolean,
  linksExpanded: boolean
) {
  const { rows } = getTermSize();
  const viewHeight = rows - 1;
  clearScreen();

  const visible = lines.slice(topLine, topLine + viewHeight);
  for (let i = 0; i < viewHeight; i++) {
    const l = visible[i] ?? "";
    const absLine = topLine + i;

    if (highlightLine === absLine && searchTerm) {
      // highlight search match
      const re = new RegExp(escapeRe(searchTerm), "gi");
      const highlighted = l.replace(re, (m) => chalk.bgHex("#f9e2af").hex("#1a1b1e")(m));
      process.stdout.write(highlighted + "\n");
    } else {
      process.stdout.write(l + "\n");
    }
  }

  renderStatusBar(article, topLine, lines.length, searching, searchTerm, hasLinks, linksExpanded);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findNext(lines: string[], term: string, from: number): number {
  if (!term) return -1;
  const re = new RegExp(escapeRe(term), "i");
  for (let i = from + 1; i < lines.length; i++) {
    if (re.test(stripAnsi(lines[i]))) return i;
  }
  // wrap
  for (let i = 0; i <= from; i++) {
    if (re.test(stripAnsi(lines[i]))) return i;
  }
  return -1;
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
  let linksExpanded = false;
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

  renderPage(lines, topLine, article, searching, searchTerm, highlightLine, hasLinks, linksExpanded);

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
        const found = findNext(lines, searchTerm, topLine - 1);
        if (found !== -1) {
          topLine = clamp(found, 0, maxT);
          highlightLine = found;
        }
        searching = false;
      } else if (key === "\x1b" || key === "\x03") {
        searching = false;
        searchTerm = "";
        highlightLine = -1;
      } else if (key === "\x7f") {
        searchTerm = searchTerm.slice(0, -1);
      } else if (key.charCodeAt(0) >= 32) {
        searchTerm += key;
      }

      renderPage(lines, topLine, article, searching, searchTerm, highlightLine, hasLinks, linksExpanded);
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
        break;

      // next search result
      case "n":
        if (searchTerm) {
          const found = findNext(lines, searchTerm, topLine);
          if (found !== -1) {
            topLine = clamp(found, 0, maxT);
            highlightLine = found;
          }
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
        }
        break;
    }

    renderPage(lines, topLine, article, searching, searchTerm, highlightLine, hasLinks, linksExpanded);
  });

  // keep alive
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
  });
}
