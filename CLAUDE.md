# huggingnews-scraper

This repo exists to pre-fetch huggingnews.com's homepage at the start of every
Claude Code session via a SessionStart hook, so the agent has today's data
immediately instead of rediscovering the proxy/TLS workaround and re-scraping
from scratch on every run.

## Background: why this needs a workaround at all

huggingnews.com is a SvelteKit app whose content loads client-side from a
Convex backend, behind Cloudflare. Two things block the obvious approaches:

1. WebFetch / plain curl with default headers gets a 403 (basic bot
   filtering) — a normal browser User-Agent header is enough to get past it.
2. Real content only exists after JS runs, so you need a real browser
   (Playwright/Chromium is pre-installed under `/opt/pw-browsers/`). But
   Chromium through this sandbox's TLS-intercepting proxy fails with
   `net::ERR_CONNECTION_RESET` on **every** https:// site — not specific to
   this one. Root cause: the proxy's TLS termination chokes on modern
   Chrome's TLS 1.3 ClientHello (the post-quantum X25519Kyber768 key share
   makes it unusually large); curl and plain Node `https` don't send that,
   so they're unaffected. Fix: launch Chrome with `--ssl-version-max=tls1.2`.

See `scripts/huggingnews_scrape.sh` for the full implementation and comments.

## What happens automatically

`.claude/hooks/session-start.sh` runs `scripts/huggingnews_scrape.sh setup`
then `... list data/latest.txt` on every session start, and always exits 0
(a scrape failure must never block the session from starting). It writes:

- `data/latest.txt` — homepage text (all visible stories, grouped by date)
- `data/latest.txt.links` — every story's `/ai/<slug>` URL, one per line
- `data/status.txt` — `OK <UTC timestamp>` or `FAILED <timestamp>` + a log tail

## What the agent should do at the start of every session

1. Read `data/status.txt` first.
2. **If it says `OK`** and `data/latest.txt` is non-empty and looks like real
   content (contains "HuggingNews" and at least one date heading like
   "Wednesday, Jul"), use `data/latest.txt` / `data/latest.txt.links`
   directly — do not re-run the scraper just to double-check it.
3. **If it says `FAILED`**, or the file is missing/empty/obviously stale for
   the task at hand, treat this as a broken pipeline, not a dead end:
   a. Run `bash scripts/huggingnews_scrape.sh setup` and
      `bash scripts/huggingnews_scrape.sh list data/latest.txt` manually and
      read the actual error.
   b. Diagnose and fix `scripts/huggingnews_scrape.sh`. Common failure modes:
      - Chromium's bundled version directory changed (`resolve_chrome()`
        should already handle this dynamically — if it still fails, check
        `ls /opt/pw-browsers`).
      - huggingnews.com changed its DOM/class names (the homepage scrape
        selects `a.story-row-link`; article pages use `page.innerText('body')`
        and parse plain text — if headline/link extraction comes back empty,
        inspect the page's current structure).
      - The TLS workaround itself stopped working (proxy behavior changed) —
        re-run the diagnostic steps in the script's header comment before
        assuming the fix flag needs to change.
      - `$HTTPS_PROXY` port changed — the script already reads it live, so
        this shouldn't be the cause, but verify `echo $HTTPS_PROXY` if
        connections fail entirely.
   c. Once fixed and verified working end-to-end (`setup` then `list` both
      succeed and produce real content), **do not push the fix to `main`
      directly.** Create a branch named `claude/fix-scraper-<short-reason>`,
      commit the fix there, and try to push that branch, then open a PR
      against the default branch (`gh pr create` or equivalent) describing
      what broke and what changed. Never attempt to push straight to `main`
      — that's expected to be rejected with a 403 regardless of whether the
      `claude/`-prefixed push below succeeds, so don't spend time retrying it.
   d. **If the `claude/`-prefixed push or PR creation fails too**, don't loop
      on it or treat it as blocking — give up after one attempt, keep the fix
      only in this session's working tree, and fall through to the
      notification step below with that caveat included. As of 2026-07,
      push/PR access requires the **Claude GitHub App** to be installed on
      this repo (see "Repo access this routine needs" below) — if it's ever
      uninstalled or access changes again, this is the first thing to check,
      but the task itself must never wait on that being fixed.
   e. Make sure the owner finds out one way or another, since there's no live
      user to ping mid-run:
      - If the PR was opened successfully, that's the primary notification.
      - Either way, say plainly in the session's own output / summary
        (whatever the current task actually produces — e.g. the news digest)
        that the scraper broke today, whether a PR was opened or the push
        failed too, and that this run used a manually-fetched result instead
        of the cached pre-fetch.
   f. Continue the user's actual task using the freshly (manually) fetched
      data regardless of how (c) and (d) went — don't block their request on
      the PR being reviewed, merged, or even successfully opened. Never
      modify `main` yourself; leave the merge decision to the owner.

## Files

- `scripts/huggingnews_scrape.sh` — the scraper (`setup` / `list [outfile]` /
  `article <url>` subcommands, with retries and clear exit codes)
- `.claude/hooks/session-start.sh` — runs the pre-fetch automatically
- `.claude/settings.json` — registers the hook
- `data/` — refreshed every session start, gitignored (not meant to be
  committed — only the scraper and hook are source of truth)

## Repo access this routine needs

Two separate things are both required, and it's easy to only do one:

1. This repo must be added to the routine's **Select repositories** list
   (routine edit form on claude.ai/code/routines) — otherwise every git
   operation, including cloning, fails with a 403 before the hook ever runs.
2. The **Claude GitHub App** must be installed on this repo
   (github.com/apps/claude → Configure → repository access → add this repo).
   This was the actual root cause of every push/PR 403 hit while setting this
   up — repo attachment via (1) alone was not sufficient for push or PR-API
   access, only for cloning.

**"Allow unrestricted branch pushes" is intentionally left off** — the
self-heal flow above only ever needs `claude/`-prefixed branch pushes, which
are allowed by default once (1) and (2) are both in place, so there's no
need to grant push access to `main`.
