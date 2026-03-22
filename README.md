# termread 🗞️

> Read any article, beautifully, in your terminal.

`termread` fetches any URL, strips out the noise (ads, nav, popups), and renders clean, readable content right in your terminal — like Firefox Reader Mode, but for your shell.

---

## install

**Run directly with bun (no install needed):**
```bash
bun run src/cli.ts https://example.com/article
```

**Or build a standalone binary:**
```bash
bun run build
# produces ./termread binary — move it to your PATH
mv termread /usr/local/bin/termread
```

**Requirements:** [Bun](https://bun.sh) v1.0+

---

## usage

```bash
termread <url> [options]
```

### options

| flag | description |
|------|-------------|
| `--raw` | plain text output, great for piping |
| `--no-color` | disable ANSI colors |
| `--help` | show help |
| `--version` | show version |

### examples

```bash
# read an article
termread https://www.wired.com/story/some-article

# pipe-friendly plain text
termread https://example.com/article --raw | grep "keyword"

# save as text
termread https://example.com/article --raw > article.txt

# chain with other tools
termread https://example.com/article --raw | wc -w
```

---

## keyboard shortcuts

| key | action |
|-----|--------|
| `j` / `↓` | scroll down |
| `k` / `↑` | scroll up |
| `d` | half page down |
| `u` | half page up |
| `Space` / `f` | full page down |
| `b` | full page up |
| `g` | go to top |
| `G` | go to bottom |
| `/` | search |
| `n` | next search result |
| `o` | open in browser |
| `q` | quit |

---

## how it works

```
URL
 └─► fetch HTML (realistic browser headers)
      └─► @mozilla/readability  ← same algo as Firefox!
           └─► turndown (HTML → Markdown)
                └─► custom ANSI renderer
                     └─► interactive pager (vim-style keys)
```

---

## roadmap

- [ ] --save flag — export as clean markdown
- [ ] bookmarks (termread --bookmarks)
- [ ] Ink/React TUI for richer UI
- [ ] config file (~/.termreadrc) for theme/width
- [ ] --summarize mode (AI summary via API)
- [ ] image-to-ascii rendering

---

## stack

- **Runtime**: Bun
- **Extraction**: @mozilla/readability (same as Firefox reader mode)
- **HTML→MD**: turndown
- **Colors**: chalk (Catppuccin Mocha theme)
- **DOM**: jsdom
