#!/usr/bin/env bash
# One-time setup of the automatic sync (.github/workflows/sync.yml), run by the owner in Google Cloud Shell from the folder
# where fetch_audio.py already works (~/hadadi-audio: it has .env and .telegram.session).
#
# It saves, as GitHub repository secrets (encrypted; GitHub never shows them again):
#   TG_API_ID, TG_API_HASH            from .env
#   TG_SESSION                        your Telegram login, read from .telegram.session (a Telethon StringSession)
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   from .env
#   SYNC_TOKEN                        a new random key; the same value goes into Cloudflare (step shown at the end)
# Nothing is printed except SYNC_TOKEN, which you copy into Cloudflare yourself. Run it again any time (it overwrites).
#
#   cd ~/hadadi-audio
#   curl -sSLO https://raw.githubusercontent.com/Mohamed-AH/hadadi/main/tools/setup_sync.sh && bash setup_sync.sh
set -euo pipefail
REPO="Mohamed-AH/hadadi"
[ -f .env ] || { echo "No .env here. Run this in the folder where fetch_audio.py works (cd ~/hadadi-audio)."; exit 1; }
[ -f .telegram.session ] || { echo "No .telegram.session here. Run fetch_audio.py once first (it logs you in)."; exit 1; }
command -v gh >/dev/null || { echo "The GitHub CLI (gh) is missing."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in to GitHub first: gh auth login"; exit 1; }
[ "$(gh api "repos/$REPO" -q .permissions.admin 2>/dev/null)" = "true" ] || { echo "Your GitHub account needs admin access to $REPO to save secrets."; exit 1; }

get() { python3 - "$1" <<'PY'
import sys
k = sys.argv[1]
for ln in open(".env", encoding="utf-8"):
    if "=" in ln and not ln.lstrip().startswith("#"):
        a, b = ln.split("=", 1)
        if a.strip() == k: print(b.split(" #")[0].strip().strip('"').strip("'"), end=""); break
PY
}
put() { [ -n "$2" ] || { echo "  $1 is empty in .env - stopping."; exit 1; }; printf %s "$2" | gh secret set "$1" -R "$REPO" >/dev/null && echo "  saved $1"; }

echo "Saving the keys from .env to GitHub ($REPO) ..."
for k in TG_API_ID TG_API_HASH R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do put "$k" "$(get "$k")"; done

echo "Saving your Telegram login ..."
SESSION=$(python3 - <<'PY'
from telethon.sessions import SQLiteSession, StringSession
s = SQLiteSession(".telegram")
if not s.auth_key: raise SystemExit("the .telegram.session file has no login in it; run fetch_audio.py once first")
print(StringSession.save(s), end="")
PY
)
put TG_SESSION "$SESSION"; unset SESSION

TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32), end='')")
put SYNC_TOKEN "$TOKEN"

cat <<EOF

Done. Two last steps:

1. Cloudflare dashboard -> Workers & Pages -> hadadi -> Settings -> Variables and Secrets -> Add:
     Type: Secret    Name: SYNC_TOKEN    Value: $TOKEN
   then Deploy. (It lets the sync job email its report to the team inbox.)

2. Start the first run and watch it:
     gh workflow run sync.yml -R $REPO
     gh run watch -R $REPO          (pick the "Sync" run; it shows each step as it goes)
   After that it runs by itself every 3 hours.
EOF
