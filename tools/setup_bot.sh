#!/usr/bin/env bash
# One-time setup of the announcements bot's instant answers, run by the owner in Google Cloud Shell (any folder).
# It asks for the bot's token (typed or pasted, not shown, not saved anywhere) and tells Telegram to send the bot's messages to
# the site's Worker (https://hadadi.emah84.workers.dev/bot) with a secret header the Worker checks (webhookSecret() in
# worker/posters.js: sha256("hadadi-webhook:" + token), first 48 hex). It also sets the bot's command menu.
# Run it again any time (for example after BotFather gives the bot a new token).
#
#   curl -sSLO https://raw.githubusercontent.com/Mohamed-AH/hadadi/main/tools/setup_bot.sh && bash setup_bot.sh
set -euo pipefail
python3 - <<'PY'
import getpass, hashlib, json, sys, urllib.request
HOOK = "https://hadadi.emah84.workers.dev/bot"
tok = getpass.getpass("The bot's token from BotFather (not shown as you paste): ").strip()
if not tok or ":" not in tok: sys.exit("That does not look like a bot token (it has the form 123456:ABC...).")
def call(method, params=None):
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/{method}", data=json.dumps(params or {}).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: j = json.load(r)
    except urllib.error.HTTPError as e: j = json.load(e)
    if not j.get("ok"): sys.exit(f"Telegram refused {method}: {j.get('description')}")
    return j["result"]
me = call("getMe")
print(f"Bot: @{me['username']}")
# the Worker must already have the token, else it answers 503 and Telegram's messages are lost
try:
    urllib.request.urlopen(urllib.request.Request(HOOK, data=b"{}", method="POST"), timeout=20)
except urllib.error.HTTPError as e:
    if e.code == 503: sys.exit("The site does not have the bot's token yet: add TELEGRAM_BOT_TOKEN in Cloudflare first (docs/announcements.md, step 2), then run this again.")
    if e.code != 403: sys.exit(f"The site's /bot answered {e.code}; is the latest version deployed?")
secret = hashlib.sha256(("hadadi-webhook:" + tok).encode()).hexdigest()[:48]
call("setWebhook", {"url": HOOK, "secret_token": secret, "allowed_updates": ["message", "callback_query"], "drop_pending_updates": True})
call("setMyCommands", {"commands": [{"command": "menu", "description": "قائمة الإعلانات"}, {"command": "list", "description": "كل الإعلانات"},
                                     {"command": "help", "description": "طريقة الاستخدام"}]})
info = call("getWebhookInfo")
print("Done: the bot now answers at once. Send it /menu in Telegram." if info.get("url") == HOOK else f"Unexpected webhook: {info}")
PY
