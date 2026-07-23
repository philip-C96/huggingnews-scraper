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
      commit the fix there, push that branch, and open a PR against the
      default branch (`gh pr create` or equivalent) describing what broke and
      what changed. This repo's routine only has default (`claude/`-prefixed)
      push access, not unrestricted push — pushing straight to `main` will be
      rejected with a 403 anyway, so don't spend time retrying that.
   d. Make the PR the notification: there's no live user to ping mid-run, so
      the PR is how the owner finds out. In the session's own output /
      summary (whatever the current task actually produces — e.g. the news
      digest), say plainly that the scraper broke today, link or name the PR,
      and note that this run used a manually-fetched result instead of the
      cached pre-fetch.
   e. Continue the user's actual task using the freshly (manually) fetched
      data — don't block their request on the PR being reviewed or merged.
      Never modify `main` yourself; leave the merge decision to the owner.

## Files

- `scripts/huggingnews_scrape.sh` — the scraper (`setup` / `list [outfile]` /
  `article <url>` subcommands, with retries and clear exit codes)
- `.claude/hooks/session-start.sh` — runs the pre-fetch automatically
- `.claude/settings.json` — registers the hook
- `data/` — refreshed every session start, gitignored (not meant to be
  committed — only the scraper and hook are source of truth)

## Repo access this routine needs

This repo must be added to the routine's **Select repositories** list (routine
edit form on claude.ai/code/routines) for the hook and self-heal flow to work
at all — otherwise every git operation, including cloning, fails with a 403
before the hook ever runs. **"Allow unrestricted branch pushes" is
intentionally left off** — the self-heal flow above only ever needs
`claude/`-prefixed branch pushes, which are allowed by default, so there's no
need to grant push access to `main`.
