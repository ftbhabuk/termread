#!/usr/bin/env bun
import { fetchArticle } from "./fetcher";
import { renderArticle } from "./renderer";
import { startPager } from "./pager";
import { showSplash } from "./splash";

const args = process.argv.slice(2);

const flags = {
  raw:     args.includes("--raw"),
  noColor: args.includes("--no-color"),
  help:    args.includes("--help") || args.includes("-h"),
  version: args.includes("--version") || args.includes("-v"),
};

const urlArg = args.find((a) => !a.startsWith("--"));

if (flags.version) {
  console.log("termread v0.1.0");
  process.exit(0);
}

if (flags.help) {
  console.log(`
  termread — read any article, beautifully, in your terminal

  usage:
    termread [url] [options]
    termread            → launches interactive splash screen

  options:
    --raw         plain text output, pipe-friendly
    --no-color    disable ANSI colors
    --help        show this help
    --version     show version

  examples:
    termread https://example.com/article
    termread https://example.com/article --raw | grep "keyword"
  `);
  process.exit(0);
}

(async () => {
  let url = urlArg;

  // No URL given → show interactive splash
  if (!url) {
    const input = await showSplash();
    if (!input) process.exit(0);
    url = input;
  }

  try {
    const article = await fetchArticle(url);
    const rendered = renderArticle(article, { noColor: flags.noColor });

    if (flags.raw) {
      console.log(rendered.plain);
    } else {
      await startPager(rendered, article);
    }
  } catch (err: any) {
    console.error(`\n  error: ${err.message}\n`);
    process.exit(1);
  }
})();