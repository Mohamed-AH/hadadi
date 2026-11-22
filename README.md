# الموقع الرسمي لفضيلة الشيخ حسن بن علي بن حسن حدادي

An Arabic (right-to-left) static website that organises the lessons, khutab and lectures of الشيخ حسن بن علي حدادي حفظه الله (Jeddah). It runs on the engine of [yahyaaljabri](https://github.com/Mohamed-AH/yahyaaljabri) (same pipeline, player, hosting and tests) with its own design, "Roshan", after the carved wooden windows of old Jeddah.

The material comes from two Telegram channels, [t.me/h_haddadi7](https://t.me/h_haddadi7) (main) and [t.me/Aqar8](https://t.me/Aqar8) («دروس الشيخ … رقم 2»; its export folder and lesson ids keep the older name `masothrbj47`). Today the site holds 516 recordings (≈247 hours) in 27 series, merged from both channels and de-duplicated.

## How it works

```
Telegram Desktop JSON exports ── tools/telegram_lessons.py ──► lessons.json (merged, de-duplicated, titled, grouped)
                                                                   │  data/telegram_overrides.json (manual fixes)
                                  tools/import_telegram.py ◄────────┘
                                          ▼
                               site/data/library.json ──► scripts/build.mjs ──► dist/ (~1,900 HTML pages) ──► Cloudflare
```

- **Export.** In Telegram Desktop: channel → ⋮ → Export chat history → Format: JSON. Media can be left out (or capped at a size): the JSON still lists every post with its file name, size and duration. Put the two exports in `telegram/h_haddadi7/` and `telegram/masothrbj47/` (folder = the channel's username; not committed), or point `TELEGRAM_EXPORTS` at their folder.
- **Automatic sync.** Since 2026-11-22 `.github/workflows/sync.yml` does all of this every 3 hours from the committed history in `data/channels/` (docs/sync.md).
- **Merge.** `python tools/telegram_lessons.py` collapses posts of the same file (size + duration) across the two channels (the main channel wins), merges a voice note and an m4a of the same lesson, takes each title from the caption (`hadadi_title()`), the file name, or the describing post before/after the audio (checked against the length stated in it), and assigns a series from the `SERIES` patterns at the top of the file. Lessons it cannot title, or that look like another speaker, are flagged.
- **Import.** `python tools/import_telegram.py` writes `site/data/library.json`, leaving out flagged lessons. Fix or approve one in `data/telegram_overrides.json`: `{"h_haddadi7-1234": {"title": "…", "series": "tawhid", "publish": true}}`.
- **Audio.** Until a lesson's audio is in our own storage, its page links to the Telegram post («استمع على تيليجرام»). `tools/fetch_audio.py` downloads the files through your own Telegram account (or takes them from a Telegram Desktop export), converts them to mono AAC 48 kbps and uploads them to R2, recording post -> URL in `site/data/media.json`; the build then shows the player. Setup and usage: [docs/audio-hosting.md](docs/audio-hosting.md).
- **Announcements.** Lesson posters («إعلانات الدروس») come from a Telegram bot the team sends them to; an hourly GitHub Action saves them and redeploys. See [docs/announcements.md](docs/announcements.md).

## Run it locally

```bash
node scripts/build.mjs && (cd dist && python3 -m http.server 8000)   # http://localhost:8000
```

Tests (Playwright + axe-core; `CHROMIUM=/path/to/chromium` to use an installed browser):

```bash
node tests/e2e.mjs http://localhost:8000 && node tests/xss_check.mjs http://localhost:8000 && node tests/a11y_check.mjs http://localhost:8000
node tests/bot_check.mjs   # the announcements bot against a fake Telegram API
# the docked player, with hosted audio faked for the Bukhari series:
MEDIA_JSON=tests/fixtures/media.json node scripts/build.mjs && node tests/player_check.mjs http://localhost:8000   # rebuild without MEDIA_JSON afterwards
```

## Still to do

- Audio files: run `tools/fetch_audio.py` (docs/audio-hosting.md) so lessons play on the site instead of linking to Telegram.
- The audio bucket's public domain, media.h-haddadi.com (`MEDIA_HOST` in `worker/index.js`). The site's domain, h-haddadi.com, is set (`SITE` in `site/js/core.js`).
- Biography page: `site/data/bio.json` (format in `docs/bio-spec.md`), only from the Sheikh's side.
- 4 flagged recordings and a few generic titles to review (`data/telegram_overrides.json`).
