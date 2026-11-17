# CLAUDE.md — الموقع الرسمي لفضيلة الشيخ حسن بن علي بن حسن حدادي

Arabic (RTL) website for the lessons, khutab and lectures of **الشيخ حسن بن علي حدادي حفظه الله** (Jeddah), built from his two Telegram channels. It runs on the same engine as Mohamed-AH/yahyaaljabri (which is itself a fork of Mohamed-AH/drwasiullah): same pipeline, player, pre-renderer, Worker and tests, but its own look and content. Read `README.md` for the pipeline.

## State (2026-11-17)
- 556 recordings in 28 series (≈257 hours) after the 2026-11-17 title/merge fixes (first version: 516 in 27) from t.me/h_haddadi7 (main channel) and t.me/masothrbj47 («دروس الشيخ … رقم 2»), JSON exports without media, 555 pages. e2e 26/26, xss pass, axe 0 violations, player 12/12, worker/bot tests pass.
- **Official site (owner 2026-11-17):** «الموقع الرسمي لفضيلة الشيخ حسن بن علي بن حسن حدادي» (`OFFICIAL_PRE`, `FULL_NAME` in `core.js`; the header keeps the short «الشيخ حسن بن علي حدادي»). Links: the main Telegram channel and the WhatsApp group (`WA_GROUP`); the second channel (masothrbj47) is still imported but not linked.
- **Audio hosting started 2026-11-17** (3 lessons in `site/data/media.json`, bucket on media.h-haddadi.com; the owner runs the script from Google Cloud Shell with a zip package and sends media.json back in the thread, since GitHub is not reachable for the owner). When the owner runs `tools/fetch_audio.py` (Telethon, the owner's own account; uploads mono AAC to R2 bucket `hadadi-media`, writes `site/data/media.json`) the pages get the docked player. **Unhosted lessons stay published** (owner 2026-11-17): a hosted lesson gets the player, the rest keep their Telegram button; `HIDE_UNHOSTED=1` switches to the Jabri rule (only hosted lessons). Audio domain: media.h-haddadi.com.
- **Domain: h-haddadi.com** (owner 2026-11-17; custom domains h-haddadi.com and www.h-haddadi.com on the Worker, zone h-haddadi.com in the same Cloudflare account). `SITE` in `core.js` = https://h-haddadi.com (canonical, link previews, sitemap; `SITE_URL` overrides); hadadi.emah84.workers.dev still answers. `MEDIA_HOST` in `worker/index.js` = https://media.h-haddadi.com (the R2 bucket's custom domain).
- No timers, announcements bot or YouTube sync yet (`JOBS = {}`, `crons: []`, no workflows). The code for them is still here from the Jabri site.
- Telegram exports are not committed; `TELEGRAM_EXPORTS=/mnt/project-files/telegram` (folders named after the channel usernames: `h_haddadi7/`, `masothrbj47/`, so lesson links are `https://t.me/<folder>/<id>`).

## Layout
- `site/` — `shell.html`, `styles.css`, `js/core.js` (constants, data model, `SECTIONS`, `SCHEDULE`, `DOCS`), `js/views.js` (pages), `js/app.js` (browser). `site/data/library.json` is generated.
- `tools/telegram_lessons.py` → `tools/import_telegram.py` → `site/data/library.json`.
  - `SERIES` patterns at the top of `telegram_lessons.py`: every book he explains is its own series; anything starting «خطبة» is a khutba; a titled **Friday** post at جامع عبدالله بن عمار that is not a lesson is a khutba too (most of his 2021–2023 khutab don't say «خطبة»).
  - Titles come from `hadadi_title()`: the first caption line that names the lesson after dropping the channel's boilerplate (`NOISE`: «العلم أشرف مطلوب…», «تم التسجيل», day/time/mosque lines, the speaker line), with a bare «الدرس الرابع» / «خطبة الجمعة» completed by the next line, and the speaker/mosque tail cut (`SPEAKER_TAIL`). Repeated titles in one series get the Hijri date or lesson number appended.
  - Flagged lessons (no title, another speaker, forwarded from another channel) are left out; fix them in `data/telegram_overrides.json`.
- Weekly schedule: `SCHEDULE` in `core.js`, typed from the channel's «🗓️ يوم …» reminder posts. Update it when they change.
- `scripts/build.mjs` pre-renders to `dist/`; `wrangler.jsonc` deploys the Worker `hadadi` (static assets + `/dl/*`, `/health`, `/bot`).

## Conventions (keep)
- Arabic, RTL. Fonts self-hosted (OFL), refreshed 2026-11-17 at the owner's request: **Markazi Text** for reading (`--font`), **Reem Kufi** for display headings and big numbers only (`--head`), **El Messiri** for UI labels/buttons/small headings (`--ui`; its stylised Arabic-Indic digits are excluded by unicode-range so digits come from Markazi), **Aref Ruqaa** (Arabic-letters subset) only for the Sheikh's name (`--name`). Text sizes are ~12% larger than with Plex because Markazi has a small eye.
- Name: always «الشيخ حسن بن علي حدادي» + «حفظه الله» (the channel writes «حفظه الله ورعاه»).
- Dates: Hijri only. Arabic text never gets `letter-spacing`.
- **Design "Roshan"** (chosen by the owner 2026-11-17, direction A of three): the teak, coral stone and sea of old Jeddah (Al-Balad). Teak bands `--night #3a2a1e`, copper-sand accent `--brass #e0b48a`, sea-teal links `--link #1d6a65`, clay `--clay #b5652e` for rules and the band edge, coral-stone page `--bg #f3ece1`. Mark = a roshan window arch with lattice (`STAR` in `core.js`, `favicon.svg`); pattern = diagonal lattice; series artwork is arch-topped. Small radii (6–8 px), no pills. Light + dark themes. Lucide icons only. Refresh (2026-11-17): one sharp accent `--sea-hi` (Red Sea turquoise) only for now-playing / current tab / focus; coral-stone grain on the page (`--stone`); a carved roshan window (`ROSHAN` in `core.js`) and light beams through a large lattice (`.beams`) behind the home hero; carved arch frieze (`--frieze`) on band and footer edges; sections as arched doorways (`.chip`); one staggered hero load sequence (respects reduced motion).
- URLs, navigation, compatibility (old iOS Safari) and safety rules are the engine's: see the Jabri repo's CLAUDE.md; they all still apply (`esc()`, `cleanQuery()`, `safeUrl()`, no third-party scripts, no secrets).

## Content integrity
- Do not invent biography, fiqh content or attributions. A bio comes only from the Sheikh's side (`site/data/bio.json`, format in `docs/bio-spec.md`).
- Only the Sheikh's own recordings: the channels repost others (السحيمي، الركابي، …); those are flagged and left out.
- Fix data in the importer or `data/*.json`, never by hand-editing `library.json`.

## Testing
After front-end changes: `node scripts/build.mjs && (cd dist && python3 -m http.server 8000) &` then `node tests/e2e.mjs`, `node tests/xss_check.mjs`, `node tests/a11y_check.mjs` (needs `axe-core`). Player: build with `MEDIA_JSON=tests/fixtures/media.json` then `node tests/player_check.mjs` (fixture = the six newest khutab), rebuild without it after. `node tests/worker_check.mjs`, `tests/bot_check.mjs`, `tests/posters_bot_check.mjs` need no server. t.me is blocked from the cloud session, so Telegram links can't be checked there.
