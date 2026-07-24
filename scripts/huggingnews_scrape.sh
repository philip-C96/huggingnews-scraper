#!/usr/bin/env bash
# huggingnews.com scraper setup + fetch, for use inside a Claude Code sandbox
# that routes outbound HTTPS through a local TLS-intercepting agent proxy.
#
# WHY THIS EXISTS
# huggingnews.com is a SvelteKit app whose content loads client-side from a
# Convex backend, and it also sits behind Cloudflare. Two problems block the
# obvious approaches:
#   1. WebFetch (and plain curl with default headers) gets a 403 - looks like
#      basic bot filtering. A normal browser UA header is enough to get past it.
#   2. The real content only exists after JS runs, so you need a real browser
#      (Playwright/Chromium, pre-installed in this sandbox under
#      /opt/pw-browsers/). But Chromium through this sandbox's TLS-intercepting
#      proxy fails with net::ERR_CONNECTION_RESET on EVERY https:// site, not
#      just this one. Root cause: the proxy's TLS termination chokes on modern
#      Chrome's TLS 1.3 ClientHello (the post-quantum X25519Kyber768 key share
#      makes it unusually large); curl and plain Node https don't send that,
#      so they work fine.
#      Fix: force Chrome to negotiate TLS 1.2 max (--ssl-version-max=tls1.2).
#      That alone was sufficient in testing - importing the proxy CA into an
#      NSS DB was NOT required to fix the reset (cert trust was never the
#      actual problem), but is included below anyway since it's cheap
#      insurance and libnss3-tools installs in a few seconds.
#
# USAGE
#   bash huggingnews_scrape.sh setup                     # one-time per fresh container
#   bash huggingnews_scrape.sh list [outfile]            # render homepage -> outfile (+ .links)
#   bash huggingnews_scrape.sh article <url> [url...]    # render one or more articles -> stdout
#
# `article` accepts multiple URLs in one call: they're all fetched through a
# single browser instance instead of launching Chromium once per URL, and
# each article's output is trimmed down to title/category/time/score/body -
# the nav bar, sidebar, and tweet dump that make up ~80% of the raw page text
# are dropped. When summarizing a day's worth of stories, pass every URL you
# need at once (`article <url1> <url2> ...`) rather than looping this script
# once per article - it's both faster and produces far less text to read.
# The actual Playwright logic lives in scripts/lib/*.js; this file is just a
# thin CLI wrapper (setup / retries / Chromium path resolution).
#
# EXIT CODES: 0 success, 2 bad usage, 3 environment/setup problem,
#             4 page fetch failed after retries.
#
# All of this is EPHEMERAL: it only persists for the lifetime of the current
# sandbox container. Re-run `setup` at the start of every fresh session/run.

set -euo pipefail
SCRATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRATCH/lib"
# The agent proxy's port is per-shell-session and can change between runs -
# always read it live from $HTTPS_PROXY rather than hardcoding it.
PROXY="${HTTPS_PROXY:-http://127.0.0.1:38453}"
RETRIES="${HN_RETRIES:-3}"

# Chromium's exact bundled-version directory name can change across image
# rebuilds (it was chromium-1194 as of 2026-07-23) - resolve it dynamically
# instead of hardcoding, and fail with a clear message if none is found.
resolve_chrome() {
  local candidate
  candidate="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1)"
  if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
    echo "ERROR: no Chromium executable found under /opt/pw-browsers/chromium-*/chrome-linux/chrome" >&2
    echo "       (the pre-installed browser path may have changed - check 'ls /opt/pw-browsers')" >&2
    exit 3
  fi
  echo "$candidate"
}

cmd_setup() {
  local chrome
  chrome="$(resolve_chrome)"

  # NSS trust store is optional insurance; skip silently if apt/network unavailable.
  if ! command -v certutil >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq libnss3-tools || \
      echo "WARN: could not install libnss3-tools, continuing without NSS CA import (not required for the TLS fix)" >&2
  fi
  if command -v certutil >/dev/null 2>&1 && [ -f /root/.ccr/agent-proxy-ca.crt ]; then
    mkdir -p "$HOME/.pki/nssdb"
    certutil -A -n "Agent Proxy CA" -t "TCu,Cu,Tu" -i /root/.ccr/agent-proxy-ca.crt -d "sql:$HOME/.pki/nssdb" 2>/dev/null || true
  fi

  if ! NODE_PATH=/opt/node22/lib/node_modules node -e "require.resolve('playwright')" 2>/dev/null; then
    echo "ERROR: playwright not resolvable via /opt/node22/lib/node_modules - check environment" >&2
    exit 3
  fi
  echo "setup OK: chrome=$chrome playwright=ok proxy=$PROXY"
}

run_node() {
  NODE_PATH=/opt/node22/lib/node_modules node "$@"
}

# Runs a lib/*.js script (plus its args) with retries, since a flaky proxy
# hiccup or slow page load shouldn't kill an otherwise-working unattended
# run. Note: for `article` with multiple URLs, a failure anywhere in the
# batch retries the WHOLE batch (simpler than per-URL retry bookkeeping, at
# the cost of re-fetching already-succeeded articles too).
run_with_retries() {
  local attempt=1
  while true; do
    if run_node "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$RETRIES" ]; then
      echo "ERROR: failed after $RETRIES attempts" >&2
      return 4
    fi
    echo "WARN: attempt $attempt/$RETRIES failed, retrying..." >&2
    attempt=$((attempt + 1))
    sleep 2
  done
}

cmd_list() {
  local out="${1:-$SCRATCH/rendered.txt}"
  local chrome
  chrome="$(resolve_chrome)"
  if run_with_retries "$LIBDIR/hn_list.js" "$chrome" "$PROXY" "$out"; then
    echo "wrote $out and $out.links"
  else
    return 4
  fi
}

cmd_article() {
  if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
    echo "usage: $0 article <url> [url...]" >&2
    return 2
  fi
  local chrome
  chrome="$(resolve_chrome)"
  run_with_retries "$LIBDIR/hn_article.js" "$chrome" "$PROXY" "$@"
}

case "${1:-}" in
  setup) cmd_setup ;;
  list) shift; cmd_list "$@" ;;
  article) shift; cmd_article "$@" ;;
  *) echo "usage: $0 {setup|list [outfile]|article <url> [url...]}" >&2; exit 2 ;;
esac
