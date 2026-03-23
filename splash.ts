import chalk from "chalk";

// ─── Catppuccin Mocha palette ────────────────────────────────────────
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
};

// ─── Terminal helpers ────────────────────────────────────────────────

function getTermSize() {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

function hideCursor() { process.stdout.write("\x1b[?25l"); }
function showCursor() { process.stdout.write("\x1b[?25h"); }
function enterAltScreen() { process.stdout.write("\x1b[?1049h\x1b[H"); }
function exitAltScreen() { process.stdout.write("\x1b[?1049l"); }
function saveCursor() { process.stdout.write("\x1b[s"); }
function restoreCursor() { process.stdout.write("\x1b[u"); }

// ─── Banner ─────────────────────────────────────────────────────────

const bannerLines = [
  C.subtle("  ╭───────────────────────────────────────╮"),
  "  │                                       │",
  C.purple.bold("  │   ▀█▀ ") + C.blue.bold("█ █ ") + C.cyan.bold("▀▄▀ ") + C.text.bold("█▀▀ ") + C.text("█   ") + C.purple.bold("█▀▀ ") + C.blue.bold("█▀▄▀█ ") + C.cyan.bold("█▀▀ ") + C.text.bold("█▄ █ ") + " │",
  C.purple.bold("  │    █  ") + C.blue.bold("█▀█ ") + C.cyan.bold(" █  ") + C.text.bold("██▄ ") + C.text("█▄▄ ") + C.purple.bold("█▄▄ ") + C.blue.bold("█ ▀ █ ") + C.cyan.bold("██▄ ") + C.text.bold("█ ▀█ ") + " │",
  "  │                                       │",
  C.subtle("  ╰───────────────────────────────────────╯"),
  "",
  C.muted("       v0.1.0  ·  read beautifully"),
];

// ─── Render ─────────────────────────────────────────────────────────

function renderSplash(url: string, cursor: string) {
  const { rows, cols } = getTermSize();

  // Vertically center the banner block
  const inputLines = 3; // blank + prompt line
  const totalBanner = bannerLines.length + inputLines;
  const topPad = Math.max(0, Math.floor((rows - totalBanner) / 2));

  let out = "\x1b[2J\x1b[H"; // clear + home

  // Top padding
  for (let i = 0; i < topPad; i++) out += "\n";

  // Banner
  for (const line of bannerLines) {
    // Center each line horizontally
    const visibleLen = line.replace(/\x1b\[[0-9;]*m/g, "").length;
    const sidePad = Math.max(0, Math.floor((cols - visibleLen) / 2));
    out += " ".repeat(sidePad) + line + "\n";
  }

  // Input prompt
  out += "\n";
  const inputContent = url.length > 0 ? C.text(url) : C.subtle("type a url");
  const promptPrefix = "  " + C.green("›") + " ";
  out += promptPrefix + inputContent + C.green(cursor);

  process.stdout.write(out);
  saveCursor();
}

// ─── Interactive URL input ──────────────────────────────────────────

export async function showSplash(): Promise<string | null> {
  // Fallback for non-interactive terminals
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("termread — read any article, beautifully, in your terminal\n");
    process.stdout.write("  usage: termread <url>\n");
    return null;
  }

  let url = "";
  const cursorFrames = [" ▎", " ▊", " █", " ▊", " ▎", " "];
  let cursorIdx = 0;
  let cleanup: (() => void) | null = null;
  let timer: Timer | null = null;

  // ── Setup
  enterAltScreen();
  hideCursor();

  cleanup = () => {
    if (timer) clearInterval(timer);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    showCursor();
    exitAltScreen();
  };

  process.on("SIGINT", () => { cleanup?.(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup?.(); process.exit(0); });

  // ── Animate cursor
  renderSplash(url, cursorFrames[0]);
  timer = setInterval(() => {
    cursorIdx = (cursorIdx + 1) % cursorFrames.length;
    renderSplash(url, cursorFrames[cursorIdx]);
  }, 350);

  // ── Input capture
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string | null>((resolve) => {
    const onData = (key: string) => {
      if (key === "\r" || key === "\n") {
        const trimmed = url.trim();
        if (trimmed.length > 0) {
          cleanup?.();
          process.stdin.removeListener("data", onData);
          resolve(trimmed);
        }
      } else if (key === "\x1b" || key === "\x03") {
        // Esc or Ctrl+C
        cleanup?.();
        process.stdin.removeListener("data", onData);
        resolve(null);
      } else if (key === "\x7f" || key === "\b") {
        // Backspace
        url = url.slice(0, -1);
        renderSplash(url, cursorFrames[cursorIdx]);
      } else if (key.charCodeAt(0) >= 32) {
        url += key;
        renderSplash(url, cursorFrames[cursorIdx]);
      }
    };

    process.stdin.on("data", onData);
  });
}
