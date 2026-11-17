# Hosting guide (Cloudflare)

The site source is in `site/`; `node scripts/build.mjs` pre-renders it into `dist/` (≈ 555 real HTML pages + sitemap + 404). It is served by a
**Cloudflare Worker with static assets** (`wrangler.jsonc`: build command `node scripts/build.mjs`, assets `./dist`, Worker `worker/index.js`).

## One-time setup
1. **Cloudflare → Workers & Pages → Create → Import a repository** → `Mohamed-AH/hadadi`, production branch `main`, project name `hadadi`.
   **Build command: empty** (wrangler.jsonc runs the build). Deploy command: `npx wrangler deploy`. Every other branch gets a preview
   URL (`<branch>-hadadi.<account>.workers.dev`).
2. **R2 bucket** `hadadi-media` (R2 → Create bucket). The Worker binds it as `MEDIA`; the deploy fails if it does not exist.
   It stays empty until `tools/fetch_audio.py` uploads audio (docs/audio-hosting.md).
3. *(Later)* **Domain:** Workers & Pages → hadadi → Settings → Domains & Routes → Add → Custom domain. Then set `SITE` in
   `site/js/core.js`. Connect `media.<domain>` to the bucket and set `MEDIA_HOST` in `worker/index.js`.

## How a change goes live
Work on a branch → pull request (Cloudflare posts a preview link) → merge to `main` → Cloudflare builds and deploys in a minute or two
(the build log shows `built 555 pages …`).

## Refreshing the lessons from Telegram
1. Telegram Desktop → each channel → ⋮ → Export chat history → JSON, media unticked → put each `result.json` in
   `telegram/h_haddadi7/` and `telegram/masothrbj47/` (or `TELEGRAM_EXPORTS=<folder>`).
2. `python tools/telegram_lessons.py && python tools/import_telegram.py` (prints the series counts and how many were left out).
3. `node scripts/build.mjs`, check locally, commit `site/data/library.json` on a branch and open a pull request.

## Headers
`site/_headers` sets caching, security headers and a report-only Content-Security-Policy; the build limits `media-src` to the audio host.
