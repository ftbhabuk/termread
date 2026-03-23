import chalk from "chalk";

const C = {
  purple: chalk.hex("#cba6f7"),
  blue:   chalk.hex("#89b4fa"),
  cyan:   chalk.hex("#89dceb"),
  green:  chalk.hex("#a6e3a1"),
  text:   chalk.hex("#cdd6f4"),
  muted:  chalk.hex("#6c7086"),
  subtle: chalk.hex("#45475a"),
  dim:    chalk.hex("#313244"),
};

const LETTERS = ["t","e","r","m","r","e","a","d"];
const GRAD    = ["#cba6f7","#b8a8f0","#a9a4ea","#9aa0e4","#8baade","#89b4fa","#89c8f0","#89dceb"];

function lerpHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r  = Math.round(ar + (br - ar) * t);
  const g  = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${bl.toString(16).padStart(2,"0")}`;
}

function stripAnsi(s: string) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

function center(line: string, cols: number): string {
  const len = stripAnsi(line).length;
  const pad = Math.max(0, Math.floor((cols - len) / 2));
  return " ".repeat(pad) + line;
}

function getTermSize() {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}
function hideCursor()     { process.stdout.write("\x1b[?25l"); }
function showCursor()     { process.stdout.write("\x1b[?25h"); }
function enterAltScreen() { process.stdout.write("\x1b[?1049h\x1b[H"); }
function exitAltScreen()  { process.stdout.write("\x1b[?1049l"); }

// ─── Static banner (built once) ──────────────────────────────────────────────
function buildBanner(): string[] {
  // Big uppercase letters — wide spaced, purple→cyan gradient, bold
  const bigRow = LETTERS.map((ch, i) =>
    chalk.hex(GRAD[i]).bold(`  ${ch.toUpperCase()}  `)
  ).join("");

  // Echo row below — same chars lowercase, dimmed
  const litRow = LETTERS.map((ch, i) =>
    chalk.hex(lerpHex(GRAD[i], "#1e1e2e", 0.6))(`  ${ch}  `)
  ).join("");

  const dot     = C.purple("·");
  const tagline = C.muted("read the web") + ` ${dot} ` + C.muted("beautifully") + ` ${dot} ` + C.muted("in your terminal");

  return [
    "",
    bigRow,
    litRow,
    "",
    tagline,
    C.subtle("v0.1.0"),
    "",
  ];
}

// ─── Render one frame ────────────────────────────────────────────────────────
function renderSplash(url: string, cursorChar: string, banner: string[], hints: string) {
  const { rows, cols } = getTermSize();

  const hasInput  = url.length > 0;
  const displayed = hasInput ? C.text(url) : C.subtle("https://...");
  const promptLine = C.green("❯ ") + displayed + C.green(cursorChar);

  const hintLine = hasInput
    ? C.subtle("↵ ") + C.muted("fetch") +
      C.subtle("   ctrl+u ") + C.muted("clear") +
      C.subtle("   esc ") + C.muted("quit")
    : C.subtle("paste a url and press ") + C.green("enter") + C.subtle(" to fetch");

  const allLines = [...banner, promptLine, "", hintLine, "", hints, ""];
  const topPad   = Math.max(1, Math.floor((rows - allLines.length) / 2));

  let out = "\x1b[2J\x1b[H";
  for (let i = 0; i < topPad; i++) out += "\n";
  for (const line of allLines) {
    out += center(line, cols) + "\n";
  }

  process.stdout.write(out);
}

// ─── Exported entrypoint ─────────────────────────────────────────────────────
export async function showSplash(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("termread — read the web, beautifully, in your terminal\n");
    process.stdout.write("  usage: termread <url>\n");
    return null;
  }

  let url       = "";
  let cursorIdx = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const cursorFrames = ["▋", "▋", "▋", " ", " ", " "];

  const banner = buildBanner();

  // Pre-build hints line (static)
  const key = (k: string) => C.dim("[") + C.text(k) + C.dim("]");
  const hints =
    key("j/k") + C.subtle(" scroll  ") +
    key("/")   + C.subtle(" search  ") +
    key("o")   + C.subtle(" open  ") +
    key("q")   + C.subtle(" quit");

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (timer) clearInterval(timer);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    showCursor();
    exitAltScreen();
  };

  process.on("SIGINT",  () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });

  enterAltScreen();
  hideCursor();
  renderSplash(url, cursorFrames[0], banner, hints);

  timer = setInterval(() => {
    cursorIdx = (cursorIdx + 1) % cursorFrames.length;
    renderSplash(url, cursorFrames[cursorIdx], banner, hints);
  }, 400);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string | null>((resolve) => {
    const onData = (key: string) => {
      if (key === "\r" || key === "\n") {
        const trimmed = url.trim();
        if (!trimmed) return;
        const finalUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
        cleanup();
        process.stdin.removeListener("data", onData);
        resolve(finalUrl);
        return;
      }
      if (key === "\x1b" || key === "\x03") {
        cleanup(); process.stdin.removeListener("data", onData); resolve(null); return;
      }
      if (key === "\x15") {
        url = ""; renderSplash(url, cursorFrames[cursorIdx], banner, hints); return;
      }
      if (key === "\x17") {
        url = url.replace(/\S+\s*$/, ""); renderSplash(url, cursorFrames[cursorIdx], banner, hints); return;
      }
      if (key === "\x7f" || key === "\b") {
        url = url.slice(0, -1); renderSplash(url, cursorFrames[cursorIdx], banner, hints); return;
      }
      if (key.charCodeAt(0) >= 32) {
        url += key; renderSplash(url, cursorFrames[cursorIdx], banner, hints);
      }
    };
    process.stdin.on("data", onData);
  });
}