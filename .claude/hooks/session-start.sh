#!/bin/bash
# Pre-fetches huggingnews.com's homepage at session start so the agent has
# today's data immediately, instead of rediscovering the proxy/TLS workaround
# and re-scraping from scratch every single run.
#
# Deliberately does NOT use `set -e`: this hook must always exit 0 so a scrape
# failure (site changed, network blip, Chrome path moved) never blocks the
# session from starting. Success/failure is instead recorded in data/status.txt
# for the agent to check and react to.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCRIPT="$REPO/scripts/huggingnews_scrape.sh"
OUT_DIR="$REPO/data"
STATUS_FILE="$OUT_DIR/status.txt"
OUT_FILE="$OUT_DIR/latest.txt"

mkdir -p "$OUT_DIR"

if [ ! -x "$SCRIPT" ]; then
  echo "FAILED $(date -u +%Y-%m-%dT%H:%M:%SZ) - $SCRIPT missing or not executable" > "$STATUS_FILE"
  exit 0
fi

if bash "$SCRIPT" setup >"$OUT_DIR/.setup.log" 2>&1 && bash "$SCRIPT" list "$OUT_FILE" >"$OUT_DIR/.list.log" 2>&1; then
  echo "OK $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATUS_FILE"
else
  {
    echo "FAILED $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "--- setup.log ---"; tail -n 20 "$OUT_DIR/.setup.log" 2>/dev/null
    echo "--- list.log ---"; tail -n 20 "$OUT_DIR/.list.log" 2>/dev/null
  } > "$STATUS_FILE"
fi

exit 0
