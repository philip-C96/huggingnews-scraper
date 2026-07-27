'use strict';
// Renders one or more huggingnews.com article pages and prints a trimmed
// summary of each to stdout. Usage: node hn_article.js <chrome> <proxy> <url> [url...]
//
// Batches all URLs through a single browser/context instead of launching a
// fresh Chromium per article - launch overhead is the same either way, but
// paying it once instead of N times matters when a session pulls a whole
// day's worth of "top 10" articles at once.
//
// Every article page repeats the same layout: <title>, <category>,
// <timestamp>, <score>, a TOPICS section (TOPICS/TAGS/KEYWORDS blocks), then
// a divider, then the body paragraphs, then either an "EARLIER VERSION
// FROM"/"CONTINUES FROM" note or straight into "KEY SOURCES" (the tweet
// dump). innerText('body') on its own also drags in the nav bar, sidebar
// trending list, and every tweet excerpt - which is 80-90% of the raw text
// and none of it is needed to summarize the story. extract() keeps just the
// title/category/time/score/body and drops the rest. The divider used to be
// a literal "◇" line; as of 2026-07 that's gone and the only remaining
// marker is a blank line right after the KEYWORDS list. DIVIDER_LINES below
// treats both as interchangeable "skip past this" chrome, so this keeps
// working if huggingnews.com ever reintroduces "◇" (with or without a blank
// line on either side of it) as well as the current blank-line-only layout.
// If "TOPICS" itself disappears, or neither divider form follows it, this
// fails closed: returns the full page text with trimmed=false rather than
// silently producing a wrong excerpt - check the article page's current
// structure if that happens (same troubleshooting step as the homepage's
// a.story-row-link selector breaking).
const { launch, UA } = require('./hn_browser');

const STOP_MARKERS = ['EARLIER VERSION FROM', 'CONTINUES FROM', 'KEY SOURCES'];
const DIVIDER_LINES = new Set(['', '◇']);

function extract(rawText) {
  const lines = rawText.split('\n');
  const topicsIdx = lines.indexOf('TOPICS');
  if (topicsIdx < 4) {
    return { title: null, category: null, time: null, score: null, body: rawText, trimmed: false };
  }

  const title = lines[topicsIdx - 4];
  const category = lines[topicsIdx - 3];
  const time = lines[topicsIdx - 2];
  const score = lines[topicsIdx - 1];

  let bodyStartIdx = -1;
  for (let i = topicsIdx + 1; i < lines.length; i++) {
    if (DIVIDER_LINES.has(lines[i].trim())) {
      bodyStartIdx = i + 1;
      break;
    }
  }
  if (bodyStartIdx < 0) {
    return { title: null, category: null, time: null, score: null, body: rawText, trimmed: false };
  }
  while (bodyStartIdx < lines.length && DIVIDER_LINES.has(lines[bodyStartIdx].trim())) bodyStartIdx++;

  let stopIdx = lines.length;
  for (let i = bodyStartIdx; i < lines.length; i++) {
    if (STOP_MARKERS.some((m) => lines[i].startsWith(m))) {
      stopIdx = i;
      break;
    }
  }
  const body = lines
    .slice(bodyStartIdx, stopIdx)
    .filter((l) => l.trim() !== '')
    .join('\n\n');

  return { title, category, time, score, body, trimmed: true };
}

async function fetchOne(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    const raw = await page.innerText('body');
    return extract(raw);
  } finally {
    await page.close();
  }
}

async function main() {
  const [, , chrome, proxy, ...urls] = process.argv;
  if (!chrome || !proxy || urls.length === 0) {
    console.error('usage: hn_article.js <chrome> <proxy> <url> [url...]');
    process.exit(2);
  }

  const browser = await launch(chrome, proxy);
  let hadFailure = false;
  try {
    const context = await browser.newContext({ userAgent: UA });
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      process.stdout.write(`=== ARTICLE ${i + 1}/${urls.length} ===\nURL: ${url}\n`);
      try {
        const a = await fetchOne(context, url);
        if (!a.trimmed) {
          process.stdout.write('WARN: layout markers not found, dumping full page text\n');
        } else {
          process.stdout.write(`TITLE: ${a.title}\nCATEGORY: ${a.category}\nTIME: ${a.time}\nSCORE: ${a.score}\n`);
        }
        process.stdout.write(`BODY:\n${a.body}\n\n`);
      } catch (err) {
        hadFailure = true;
        process.stdout.write(`ERROR: ${err.message}\n\n`);
      }
    }
  } finally {
    await browser.close();
  }
  // A single failed URL fails the whole batch (matching the previous
  // single-article behavior) so huggingnews_scrape.sh's retry wrapper
  // re-runs it - simpler than per-URL retry bookkeeping, at the cost of
  // re-fetching already-succeeded articles too on a retry.
  if (hadFailure) process.exit(4);
}

module.exports = { extract };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
