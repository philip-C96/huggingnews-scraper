'use strict';
// Shared Playwright launch config for the huggingnews.com scraper scripts.
// The --ssl-version-max=tls1.2 flag works around the sandbox's TLS-
// intercepting proxy choking on Chrome's TLS 1.3 ClientHello - see the
// header comment in huggingnews_scrape.sh for the full story.
const { chromium } = require('playwright');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function launch(chrome, proxy) {
  return chromium.launch({
    executablePath: chrome,
    headless: true,
    proxy: { server: proxy },
    args: ['--ssl-version-max=tls1.2'],
  });
}

module.exports = { launch, UA };
