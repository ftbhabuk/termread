# AGENTS.md

Instructions for coding agents working in this repository.

## Project Overview

**termread** — a terminal article reader. Fetches any URL, extracts readable content via
@mozilla/readability, converts HTML to Markdown with turndown, renders with ANSI colors
(Catppuccin Mocha palette via chalk), and displays in an interactive vim-style pager.
Built with Bun. No test framework is set up.

## Build & Run Commands

```bash
bun install                  # install dependencies
bun run cli.ts <url>         # run directly
bun run start <url>          # same as above (npm script)
bun run cli.ts --help        # show usage

bun build cli.ts --compile --outfile termread   # build standalone binary
                                                   # (note: binary has a known jsdom
                                                   # bundling issue; prefer `bun run`)
```

There are **no tests, linter, or typecheck scripts** in package.json. To typecheck:
```bash
bun x tsc --noEmit --strict --moduleResolution bundler --module esnext \
    --target esnext --esModuleInterop --skipLibCheck cli.ts
```
Note: pre-existing TS errors exist in `fetcher.ts` (Readability parsed object nullability).

## Architecture

```
cli.ts       → entry point, argument parsing, orchestrates the pipeline
fetcher.ts   → fetches URL, extracts article (readability), metadata, links
renderer.ts  → converts article HTML to Markdown, renders to ANSI-colored lines
pager.ts     → interactive terminal pager (alt screen, raw mode, vim keys)
splash.ts    → interactive URL input screen when no URL is given
```

Data flow: `cli.ts` → `fetcher.ts` (Article) → `renderer.ts` (RenderedArticle) → `pager.ts`

## Code Style

### Language & Module System
- TypeScript with ES modules (`"type": "module"`)
- Bun runtime — use Bun APIs (`Bun.spawn`, `Bun.read`, etc.) freely
- No build step for development; `bun run cli.ts` runs TypeScript directly

### Imports
- Named exports preferred: `import { fetchArticle } from "./fetcher"`
- Use `import type` for type-only imports: `import type { Article } from "./fetcher"`
- Relative imports only (no path aliases)
- External deps: chalk, turndown, @mozilla/readability, jsdom, node-html-parser

### Naming
- **Files**: lowercase, single word (`cli.ts`, `fetcher.ts`, `pager.ts`)
- **Interfaces**: PascalCase (`Article`, `RenderedArticle`, `Link`)
- **Functions**: camelCase (`fetchArticle`, `renderPage`, `stripAnsi`)
- **Constants**: UPPER_CASE for module-level config (`HEADERS`, `CONTENT_WIDTH`), camelCase for color palette objects (`C`)
- Private helpers are non-exported functions (no `export` keyword)

### Types
- Explicit return types on exported functions
- Use `| null` for nullable values (not `undefined`)
- Options objects use optional properties with defaults: `opts: { noColor?: boolean } = {}`
- Prefer interfaces over types for object shapes

### Formatting
- 2-space indentation
- Semicolons required
- Double quotes for strings
- Trailing commas in multi-line objects/arrays
- Short functions on one line are acceptable: `function hideCursor() { ... }`
- Align object values with extra spaces for readability:
  ```typescript
  const C = {
    green:  chalk.hex("#a6e3a1"),
    blue:   chalk.hex("#89b4fa"),
  };
  ```

### Error Handling
- Throw `Error` with descriptive messages for user-facing failures
- Use `try/catch` with bare `catch` (no parameter) when errors are silently ignored
- Status/progress output goes to **stderr** via `process.stderr.write()`
- User-facing errors via `console.error()`, then `process.exit(1)`
- Check `process.stdin.isTTY` / `process.stdout.isTTY` before using terminal features

### Terminal Output
- Use `process.stdout.write()` for raw terminal control (ANSI escape sequences)
- Use `console.log()` only for final user output (`--raw` mode, `--help`)
- Alt screen: `\x1b[?1049h` enter, `\x1b[?1049l` exit
- Always restore cursor and exit alt screen in cleanup handlers
- Register `SIGINT` and `SIGTERM` handlers for graceful cleanup
- Color palette: Catppuccin Mocha — import chalk and define a local `C` object per file

## Key Dependencies

| package | purpose |
|---------|---------|
| `@mozilla/readability` | article extraction (same algorithm as Firefox Reader Mode) |
| `turndown` | HTML → Markdown conversion |
| `chalk` | terminal ANSI colors |
| `jsdom` | DOM parsing for readability |
| `node-html-parser` | lightweight HTML parsing |
