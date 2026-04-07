import chalk from "chalk";
import { fetchArticle, type Article } from "./fetcher";
import { renderArticle, type RenderedArticle } from "./renderer";

const C = {
  green:  chalk.hex("#a6e3a1"),
  blue:   chalk.hex("#89b4fa"),
  muted:  chalk.hex("#6c7086"),
  subtle: chalk.hex("#45475a"),
  yellow: chalk.hex("#f9e2af"),
  cyan:   chalk.hex("#89dceb"),
  red:    chalk.hex("#f38ba8"),
};

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07|\x1b\]8;;\x07/g;

interface HighlightRange {
  start: number;
  end: number;
}

interface MatchPos {
  line: number;
  start: number;
  end: number;
}

interface PagerState {
  article: Article;
  rendered: RenderedArticle;
  lines: string[];
  topLine: number;
  searching: boolean;
  searchTerm: string;
  highlightLine: number;
  highlightRange: HighlightRange | null;
  linksExpanded: boolean;
  matchIdx: number;
  matchTotal: number;
  matchPos: number;
  matches: MatchPos[];
  openingLink: boolean;
  linkInput: string;
  flashMessage: string | null;
}

function getTermSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 40,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function hasLinks(rendered: RenderedArticle): boolean {
  return rendered.linksStart >= 0 && rendered.linksFull.length > 0;
}

function buildLines(rendered: RenderedArticle, linksExpanded: boolean): string[] {
  if (!hasLinks(rendered)) return [...rendered.lines];

  const beforeLinks = rendered.lines.slice(0, rendered.linksStart);
  const afterLinks = rendered.lines.slice(rendered.linksStart + rendered.linksCollapsed.length);
  const linkLines = linksExpanded ? rendered.linksFull : rendered.linksCollapsed;
  return [...beforeLinks, ...linkLines, ...afterLinks];
}

function createPagerState(rendered: RenderedArticle, article: Article): PagerState {
  return {
    article,
    rendered,
    lines: buildLines(rendered, false),
    topLine: 0,
    searching: false,
    searchTerm: "",
    highlightLine: -1,
    highlightRange: null,
    linksExpanded: false,
    matchIdx: 0,
    matchTotal: 0,
    matchPos: -1,
    matches: [],
    openingLink: false,
    linkInput: "",
    flashMessage: null,
  };
}

function cloneState(state: PagerState): PagerState {
  return {
    ...state,
    lines: [...state.lines],
    matches: state.matches.map((match) => ({ ...match })),
    highlightRange: state.highlightRange ? { ...state.highlightRange } : null,
    openingLink: false,
    linkInput: "",
    flashMessage: null,
  };
}

function normalNav(hasArticleLinks: boolean, hasHistory: boolean): string {
  return C.muted(" j/k") + C.subtle(":scroll ") +
    C.muted("d/u") + C.subtle(":page ") +
    C.muted("/") + C.subtle(":search ") +
    (hasArticleLinks ? C.muted("e") + C.subtle(":links ") : "") +
    (hasArticleLinks ? C.muted("o") + C.subtle(":open ") : "") +
    (hasHistory ? C.muted("h") + C.subtle(":back ") : "") +
    C.muted("q") + C.subtle(":quit");
}

function renderStatusBar(
  state: PagerState,
  loadingMessage: string | null,
  historyDepth: number
) {
  const { cols } = getTermSize();
  const pct = Math.round((state.topLine / Math.max(1, state.lines.length - 1)) * 100);
  const domain = (() => {
    try { return new URL(state.article.url).hostname; } catch { return state.article.url; }
  })();
  const articleHasLinks = hasLinks(state.rendered);
  const hasHistory = historyDepth > 0;

  const matchInfo = state.searchTerm && state.matchTotal > 0
    ? C.yellow(` ${state.matchIdx}/${state.matchTotal}`)
    : state.searchTerm && !state.searching
    ? C.subtle(" no matches")
    : "";

  const left = loadingMessage
    ? C.yellow(" loading ") + C.muted(loadingMessage)
    : state.openingLink
    ? C.yellow(" open ") +
      C.muted(state.linkInput) +
      C.subtle("_") +
      C.subtle(` 1-${state.article.links.length}`)
    : state.searching
    ? C.yellow(" / ") + C.muted(state.searchTerm) + C.subtle("_") + matchInfo
    : state.flashMessage
    ? C.red(" note ") + C.muted(state.flashMessage)
    : C.subtle(" ") + C.muted(domain) + matchInfo;

  const mid = C.subtle(state.article.siteName || "");
  const right = C.subtle(`${pct}% `) +
    C.green("●") + C.subtle(` ln ${state.topLine + 1}/${state.lines.length} `);

  const nav = loadingMessage
    ? C.subtle(" please wait")
    : state.openingLink
    ? C.muted(" digits") + C.subtle(":number ") +
      C.muted("enter") + C.subtle(":open ") +
      C.muted("esc") + C.subtle(":cancel ") +
      (hasHistory ? C.muted("h") + C.subtle(":back ") : "") +
      C.muted("q") + C.subtle(":quit")
    : state.searching
    ? C.muted(" enter") + C.subtle(":search ") + C.muted("esc") + C.subtle(":cancel ")
    : normalNav(articleHasLinks, hasHistory);

  const leftStr  = stripAnsi(left);
  const midStr   = stripAnsi(mid);
  const rightStr = stripAnsi(right);
  const navStr   = stripAnsi(nav);

  const totalVisible = leftStr.length + midStr.length + rightStr.length + navStr.length;
  const spaces = Math.max(0, cols - totalVisible);
  const leftPad = Math.floor(spaces / 3);
  const rightPad = spaces - leftPad - Math.floor(spaces / 3);

  process.stdout.write(
    "\x1b[" + getTermSize().rows + ";1H" +
    "\x1b[48;2;42;43;47m" +
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
    const match = matches[i];
    if (match.line > fromLine) return i;
    if (match.line === fromLine && match.start > fromStart) return i;
  }
  return 0;
}

function clearSearch(state: PagerState) {
  state.searching = false;
  state.searchTerm = "";
  state.highlightLine = -1;
  state.highlightRange = null;
  state.matchIdx = 0;
  state.matchTotal = 0;
  state.matchPos = -1;
  state.matches = [];
}

function refreshSearch(state: PagerState) {
  state.matches = findMatches(state.lines, state.searchTerm);
  state.matchTotal = state.matches.length;
  if (state.matchTotal > 0) {
    const fromLine = state.highlightLine >= 0 ? state.highlightLine : state.topLine - 1;
    const fromStart = state.highlightRange ? state.highlightRange.start : -1;
    state.matchPos = findNextMatchIndex(state.matches, fromLine, fromStart);
    const match = state.matches[state.matchPos];
    state.highlightLine = match.line;
    state.highlightRange = { start: match.start, end: match.end };
    state.matchIdx = state.matchPos + 1;
  } else {
    state.matchPos = -1;
    state.matchIdx = 0;
    state.highlightLine = -1;
    state.highlightRange = null;
  }
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() { process.stdout.write("\x1b[?25l"); }
function showCursor() { process.stdout.write("\x1b[?25h"); }
function enterAltScreen() { process.stdout.write("\x1b[?1049h"); }
function exitAltScreen() { process.stdout.write("\x1b[?1049l"); }

function renderPage(
  state: PagerState,
  loadingMessage: string | null,
  historyDepth: number
) {
  const { rows } = getTermSize();
  const viewHeight = rows - 1;
  clearScreen();

  const visible = state.lines.slice(state.topLine, state.topLine + viewHeight);
  for (let i = 0; i < viewHeight; i++) {
    const line = visible[i] ?? "";
    const absLine = state.topLine + i;

    if (state.highlightLine === absLine && state.searchTerm && state.highlightRange) {
      const highlighted = highlightMatchRange(line, state.highlightRange.start, state.highlightRange.end);
      process.stdout.write(highlighted + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }

  renderStatusBar(state, loadingMessage, historyDepth);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function startPager(
  rendered: RenderedArticle,
  article: Article,
  opts: { noColor?: boolean } = {}
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(rendered.plain);
    return;
  }

  const noColor = opts.noColor ?? false;
  const history: PagerState[] = [];
  let state = createPagerState(rendered, article);
  let loadingMessage: string | null = null;
  let loading = false;
  let onData = (_key: string) => {};

  const draw = () => {
    const { rows } = getTermSize();
    const viewHeight = rows - 1;
    const maxTop = Math.max(0, state.lines.length - viewHeight);
    state.topLine = clamp(state.topLine, 0, maxTop);
    renderPage(state, loadingMessage, history.length);
  };

  const cleanup = () => {
    process.stdin.off("data", onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    showCursor();
    exitAltScreen();
    process.exit(0);
  };

  const showFlash = (message: string) => {
    state.flashMessage = message;
  };

  const openLink = async (index: number) => {
    const link = state.article.links[index];
    if (!link) {
      showFlash(`link ${index + 1} not found`);
      return;
    }

    const previous = cloneState(state);
    state.openingLink = false;
    state.linkInput = "";
    state.flashMessage = null;
    loading = true;
    loadingMessage = `[${index + 1}] ${link.host}`;
    draw();

    try {
      const nextArticle = await fetchArticle(link.url, { quiet: true });
      const nextRendered = renderArticle(nextArticle, { noColor });
      history.push(previous);
      state = createPagerState(nextRendered, nextArticle);
    } catch (err: any) {
      showFlash(err instanceof Error ? err.message : "could not open link");
    } finally {
      loading = false;
      loadingMessage = null;
      draw();
    }
  };

  enterAltScreen();
  hideCursor();

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  draw();

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  onData = (key: string) => {
    void handleKey(key);
  };

  async function handleKey(key: string): Promise<void> {
    if (loading) {
      if (key === "q" || key === "Q") cleanup();
      return;
    }

    const { rows } = getTermSize();
    const viewHeight = rows - 1;
    const maxTop = Math.max(0, state.lines.length - viewHeight);

    if (!state.searching && !state.openingLink) {
      state.flashMessage = null;
    }

    if (state.searching) {
      if (key === "\r" || key === "\n") {
        state.matches = findMatches(state.lines, state.searchTerm);
        state.matchTotal = state.matches.length;
        if (state.matchTotal > 0) {
          state.matchPos = findNextMatchIndex(state.matches, state.topLine - 1, -1);
          const match = state.matches[state.matchPos];
          state.highlightLine = match.line;
          state.highlightRange = { start: match.start, end: match.end };
          state.matchIdx = state.matchPos + 1;
          state.topLine = clamp(match.line, 0, maxTop);
        } else {
          state.matchPos = -1;
          state.matchIdx = 0;
          state.highlightLine = -1;
          state.highlightRange = null;
        }
        state.searching = false;
      } else if (key === "\x1b" || key === "\x03") {
        clearSearch(state);
      } else if (key === "\x7f") {
        state.searchTerm = state.searchTerm.slice(0, -1);
      } else if (key.charCodeAt(0) >= 32) {
        state.searchTerm += key;
      }

      draw();
      return;
    }

    if (state.openingLink) {
      if (key === "\r" || key === "\n") {
        if (!state.linkInput) {
          showFlash("enter a link number");
          draw();
          return;
        }
        const linkIdx = parseInt(state.linkInput, 10) - 1;
        await openLink(linkIdx);
        return;
      }
      if (key === "\x1b" || key === "\x03") {
        state.openingLink = false;
        state.linkInput = "";
        draw();
        return;
      }
      if (key === "h") {
        if (!history.length) {
          showFlash("no previous article");
        } else {
          state = history.pop() as PagerState;
        }
        draw();
        return;
      }
      if (key === "\x7f") {
        state.linkInput = state.linkInput.slice(0, -1);
        draw();
        return;
      }
      if (/^\d$/.test(key)) {
        state.linkInput += key;
        draw();
      }
      return;
    }

    switch (key) {
      case "q":
      case "Q":
      case "\x03":
        cleanup();
        return;

      case "j":
      case "\x1b[B":
        state.topLine = clamp(state.topLine + 1, 0, maxTop);
        break;

      case "k":
      case "\x1b[A":
        state.topLine = clamp(state.topLine - 1, 0, maxTop);
        break;

      case "d":
        state.topLine = clamp(state.topLine + Math.floor(viewHeight / 2), 0, maxTop);
        break;

      case "u":
        state.topLine = clamp(state.topLine - Math.floor(viewHeight / 2), 0, maxTop);
        break;

      case " ":
      case "f":
        state.topLine = clamp(state.topLine + viewHeight, 0, maxTop);
        break;

      case "b":
        state.topLine = clamp(state.topLine - viewHeight, 0, maxTop);
        break;

      case "g":
        state.topLine = 0;
        break;

      case "G":
        state.topLine = maxTop;
        break;

      case "/":
        state.searching = true;
        state.searchTerm = "";
        state.matchIdx = 0;
        state.matchTotal = 0;
        state.matchPos = -1;
        state.matches = [];
        state.highlightLine = -1;
        state.highlightRange = null;
        break;

      case "n":
        if (state.searchTerm && state.matches.length) {
          state.matchPos = (state.matchPos + 1) % state.matches.length;
          const match = state.matches[state.matchPos];
          state.highlightLine = match.line;
          state.highlightRange = { start: match.start, end: match.end };
          state.matchIdx = state.matchPos + 1;
          state.topLine = clamp(match.line, 0, maxTop);
        }
        break;

      case "o":
        if (!hasLinks(state.rendered)) {
          showFlash("no links in this article");
        } else {
          state.openingLink = true;
          state.linkInput = "";
        }
        break;

      case "h":
        if (!history.length) {
          showFlash("no previous article");
        } else {
          state = history.pop() as PagerState;
        }
        break;

      case "\x1b[8~":
        break;

      case "e":
        if (hasLinks(state.rendered)) {
          state.linksExpanded = !state.linksExpanded;
          state.lines = buildLines(state.rendered, state.linksExpanded);
          if (state.searchTerm) {
            refreshSearch(state);
          }
        }
        break;
    }

    draw();
  }

  process.stdin.on("data", onData);

  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
  });
}
