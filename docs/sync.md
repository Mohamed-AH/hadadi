# Automatic sync (lessons, audio, videos)

`.github/workflows/sync.yml` runs `tools/sync.py` every 3 hours from 06:17 to 00:17 Riyadh time (and on demand:
`gh workflow run sync.yml -R Mohamed-AH/hadadi`). One run:

1. `tools/tg_fetch.py` reads the new posts of both Telegram channels (the owner's login, read-only) into
   `data/channels/<folder>/result.json`, the channels' history in the shape of a Telegram Desktop export (committed; the
   last 30 posts are re-read so a corrected caption is picked up).
2. `tools/telegram_lessons.py` + `tools/import_telegram.py` (`TELEGRAM_EXPORTS=data/channels`) rebuild `site/data/library.json`
   with the same rules and `data/telegram_overrides.json`. **A run that would remove a lesson from the site stops and changes nothing.**
   Posts the rules leave out (another speaker, forwarded, no title) are listed in the report as held.
3. `tools/fetch_audio.py --max-gb 3` hosts the new lessons' audio in R2 (`site/data/media.json`). A file that fails is retried next run.
4. `tools/youtube_sync.py` lists the YouTube channel with yt-dlp and adds the Sheikh's new videos to `data/youtube.json` by their
   titles (see the file's docstring), then `tools/import_youtube.mjs`. If YouTube refuses GitHub's servers, the video step is skipped.
5. `node scripts/build.mjs` must succeed, then the changes are committed to main and Cloudflare redeploys.
6. The report: the run's summary page on GitHub, and an email to the team inbox (`POST /api/sync-report`, `worker/sync_report.js`,
   Worker secret `SYNC_TOKEN`) when something was added, held or failed.

A title fix is still an entry in `data/telegram_overrides.json`; the next run applies it.

## Setup (owner, once, in Cloud Shell)

    cd ~/hadadi-audio
    curl -sSLO https://raw.githubusercontent.com/Mohamed-AH/hadadi/main/tools/setup_sync.sh && bash setup_sync.sh

It saves `TG_API_ID`, `TG_API_HASH`, `TG_SESSION` (the login from `.telegram.session`), the three R2 keys and a new `SYNC_TOKEN`
as GitHub repository secrets, and prints `SYNC_TOKEN` for Cloudflare (Workers & Pages > hadadi > Settings > Variables and
Secrets > Add, type Secret). If Telegram ever ends the login, the report says so: log in again with fetch_audio.py, then run
setup_sync.sh again.

Tests: `python tests/tg_fetch_check.py` (needs telethon), `python tests/youtube_sync_check.py`, `node tests/sync_report_check.mjs`.
