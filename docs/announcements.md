# Announcement posters (إعلانات الدروس)

Posters for lessons and timetables appear on the home page («إعلانات الدروس») and on `/announcements/`. Visitors can open each
one at full size. A poster comes down by itself after its end date.

The team adds them through a Telegram bot. Everything runs on Cloudflare (no GitHub, no Google Cloud, nothing to pay for on the
free plans): the list is kept in D1, the pictures in R2.

## For the team

Open the bot and send **/menu** (or tap the menu button). Everything is buttons:

- **📋 الإعلانات:** all posters in the order they appear on the site, each with its state (منشور، مسودة، انتهى). Tap one to:
  - **✏️ تعديل النص:** the bot asks for the new title; answer by replying to its question.
  - **📅 تاريخ الانتهاء:** a Hijri date such as `١٤٤٨/٧/٢` (it comes down after that day), or `بدون`.
  - **⬆️ / ⬇️ / ⏫:** move it one place up or down, or to the top.
  - **🗑 حذف:** asks once more before removing it.
- **➕ إضافة إعلان:** send the picture (as a photo, or as a file for full quality; JPEG, PNG or WebP, up to 10 MB). The bot
  asks for the title and the end date (unless they are already in the caption, e.g. first line the title and `حتى ١٤٤٨/٧/٢`),
  then shows the poster with **✅ نشر في الأعلى / في الأسفل**. Until then it is a draft and does not show on the site.
- **Lesson schedule:** a title starting with «جدول» (or `#جدول` in the caption) marks the schedule poster; publishing a new one
  takes the old one down by itself.

The bot answers at once; the site shows each change about two minutes later. Only the Telegram users in `BOT_ADMINS` can use it;
anyone else is told their Telegram id, so the owner can add them.

## One-time setup (owner)

1. **The bot.** In Telegram open **@BotFather**, send `/newbot`, pick a name (e.g. «إعلانات موقع الشيخ حسن حدادي») and a
   username ending in `bot`. BotFather replies with a **token**. Keep it private: it goes only into Cloudflare and the setup
   script below, never into a chat or the repo.
2. **Cloudflare** → Workers & Pages → **hadadi** → Settings → Variables and Secrets → **Add**, then **Deploy**:
   - `TELEGRAM_BOT_TOKEN`, type *Secret*, the token.
   - `BOT_ADMINS`, type *Secret*, the Telegram user ids allowed to manage posters, comma-separated (e.g. `12345,67890`).
     To get someone's id, they send the bot any message after step 3; it answers with their id. Add it and Deploy again.
   - `DEPLOY_HOOK` (if the portal's «نشر» is not set up yet): Settings → Builds → Deploy Hooks → create one for branch `main`,
     copy its URL into a *Secret* named `DEPLOY_HOOK`. Without it a change still saves, and shows with the next build (the
     automatic sync's next push, at most three hours).
3. **Cloud Shell**, once (it asks for the token without showing it, and saves it nowhere):

       curl -sSLO https://raw.githubusercontent.com/Mohamed-AH/hadadi/main/tools/setup_bot.sh && bash setup_bot.sh

   It points the bot at the Worker (`https://hadadi.emah84.workers.dev/bot`) and sets its command menu. Then send the bot
   `/menu`.

The D1 table is created by the Worker on first use (`db/migrations/0004_posters.sql` is the same statement, for the record).

## How it works

- `worker/bot.js` answers every message and button. Telegram calls it with a secret header derived from the bot token
  (`webhookSecret()` in `worker/posters.js`; `setup_bot.sh` computes the same value); other calls get 403.
- `worker/poster_store.js` keeps the list as one D1 row with a version number, so two admins at once never overwrite each
  other (a write that lost the race is read again and retried). A new picture is downloaded from Telegram at once and saved to
  R2 as `ann/<sha16>.<ext>`, with Telegram's own smaller size (photos: the first of at least 480 px; files: the document
  thumbnail) as the preview `ann/thumb/<sha16>.jpg`. The Worker serves them at `/ann/...` (immutable; the name is the hash).
  Pictures that no poster uses any more are deleted with the change that dropped them.
- A change visitors would see (publish, edit, move, delete of a published poster) calls the deploy hook. The build
  (`scripts/posters.mjs`, on Cloudflare only) reads `GET /api/posters` (published posters, public fields only) and pre-renders
  them; a 404 (an older Worker) falls back to `site/data/announcements.json`, and an outage stops the build instead of dropping
  the posters. Local builds read the repo file.
- Every night at 00:07 Riyadh a Worker timer (`EXPIRE_CRON`) drops posters whose end date has passed and rebuilds the site.
  The site also hides expired posters and drafts itself (Riyadh date), at build time and in the browser.

Test: `node tests/posters_bot_check.mjs` (fake Telegram, SQLite as D1, a fake R2).
