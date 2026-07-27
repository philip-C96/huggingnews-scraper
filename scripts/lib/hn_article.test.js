'use strict';
// Unit tests for extract() in hn_article.js - no browser needed, just feeds
// synthetic page text through the same parsing logic used on real pages.
// Run with: node scripts/lib/hn_article.test.js
const assert = require('assert');
const { extract } = require('./hn_article');

function withMeta(topicsBlock, bodyLines, trailer) {
  return [
    'HN', 'HuggingNews', 'What is happening in AI today?', 'About', 'Sign in',
    'Some Headline',
    'Models',
    'Jul 25, 5:17 AM EDT',
    '190/117',
    'TOPICS',
    ...topicsBlock,
    ...bodyLines,
    ...(trailer || []),
  ].join('\n');
}

function check(name, rawText, expectedBody) {
  const result = extract(rawText);
  assert.strictEqual(result.trimmed, true, `${name}: expected trimmed=true`);
  assert.strictEqual(result.title, 'Some Headline', `${name}: title`);
  assert.strictEqual(result.category, 'Models', `${name}: category`);
  assert.strictEqual(result.time, 'Jul 25, 5:17 AM EDT', `${name}: time`);
  assert.strictEqual(result.score, '190/117', `${name}: score`);
  assert.strictEqual(result.body, expectedBody, `${name}: body`);
  console.log(`ok - ${name}`);
}

const TOPICS_BLOCK = ['🤖 AI', 'TAGS', 'AI', 'AI Models', 'KEYWORDS', 'kw1', 'kw2'];
const BODY = ['Body paragraph one.', '', 'Body paragraph two.'];
const EXPECTED_BODY = 'Body paragraph one.\n\nBody paragraph two.';
const TRAILER = ['KEY SOURCES', 'noise'];

// Current site layout: no "◇" at all, just a blank line after KEYWORDS.
check(
  'current layout (blank line only)',
  withMeta(TOPICS_BLOCK, ['', ...BODY], TRAILER),
  EXPECTED_BODY
);

// Old layout: blank line, then "◇", then blank line, then body.
check(
  'old layout (blank + ◇ + blank)',
  withMeta(TOPICS_BLOCK, ['', '◇', '', ...BODY], TRAILER),
  EXPECTED_BODY
);

// Old layout variant: "◇" directly after KEYWORDS (no leading blank), blank after.
check(
  'old layout (◇ directly, blank after)',
  withMeta(TOPICS_BLOCK, ['◇', '', ...BODY], TRAILER),
  EXPECTED_BODY
);

// Old layout variant: "◇" directly after KEYWORDS, body starts immediately
// after with no blank line at all on either side.
check(
  'old layout (◇ directly, no surrounding blanks)',
  withMeta(TOPICS_BLOCK, ['◇', ...BODY], TRAILER),
  EXPECTED_BODY
);

// No body at all before hitting a stop marker - still trims cleanly to an
// empty body rather than false-failing.
check(
  'body ends right at KEY SOURCES',
  withMeta(TOPICS_BLOCK, [''], TRAILER),
  ''
);

// Failure mode: no TOPICS marker on the page at all - fails closed.
{
  const raw = ['no', 'topics', 'section', 'here'].join('\n');
  const result = extract(raw);
  assert.strictEqual(result.trimmed, false, 'missing TOPICS: expected trimmed=false');
  assert.strictEqual(result.body, raw, 'missing TOPICS: body should be full raw text');
  console.log('ok - missing TOPICS fails closed');
}

// Failure mode: TOPICS present but never followed by a blank line or "◇"
// before EOF - fails closed rather than guessing.
{
  const raw = withMeta(TOPICS_BLOCK, [], null).replace(/\n$/, '') + '\nno-divider-here';
  const result = extract(raw);
  assert.strictEqual(result.trimmed, false, 'no divider found: expected trimmed=false');
  console.log('ok - no divider found fails closed');
}

console.log('All hn_article.extract() tests passed.');
