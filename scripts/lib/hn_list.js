'use strict';
// Renders huggingnews.com's homepage and writes its visible text + every
// story link to disk. Usage: node hn_list.js <chrome> <proxy> <outFile>
const fs = require('fs');
const { launch, UA } = require('./hn_browser');

async function main() {
  const [, , chrome, proxy, outFile] = process.argv;
  if (!chrome || !proxy || !outFile) {
    console.error('usage: hn_list.js <chrome> <proxy> <outFile>');
    process.exit(2);
  }
  const browser = await launch(chrome, proxy);
  try {
    const context = await browser.newContext({ userAgent: UA, locale: 'zh-TW' });
    const page = await context.newPage();
    await page.goto('https://huggingnews.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    fs.writeFileSync(outFile, await page.innerText('body'));
    // every story link (usually /ai/<slug>, but some are /tech/, /earnings/,
    // /us-markets/, etc. - path prefix varies by category), so callers can
    // map headline -> URL
    const links = await page.$$eval('a.story-row-link', (as) => as.map((a) => a.getAttribute('href')));
    fs.writeFileSync(outFile + '.links', [...new Set(links)].join('\n'));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
