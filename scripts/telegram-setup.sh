#!/bin/bash
# Sets up the CashOut Check Telegram bot (server/telegram.ts). Run it up to three times:
#   1. cashout-tgsetup              first time: stores the bot token from @BotFather in Secret Manager
#   2. (deploy)  then cashout-tgsetup   again: points Telegram at the live server and sets the bot's menu and description
#   3. cashout-tgsetup owner <id>    marks your own Telegram account (the number /myid shows) so your checks
#                                              are unlimited and never counted as a user. Takes effect on the next deploy.
set -uo pipefail
SA="1021990235790-compute@developer.gserviceaccount.com"
SITE="https://cashout-check-1021990235790.us-central1.run.app"
CLIP=/data/data/com.termux/files/usr/bin/termux-clipboard-get

save_secret() { # name value
  if gcloud secrets describe "$1" >/dev/null 2>&1; then printf %s "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null || exit 1
  else printf %s "$2" | gcloud secrets create "$1" --data-file=- >/dev/null || exit 1; fi
  gcloud secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null || exit 1
}

if [ "${1:-}" = "owner" ]; then
  [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "Usage: cashout-tgsetup owner <your Telegram ID from /myid>"; exit 1; }
  save_secret CASHOUT_TELEGRAM_OWNER_IDS "$2" && echo "Saved. Your checks count as the owner's after the next deploy."
  exit 0
fi

if ! gcloud secrets describe CASHOUT_TELEGRAM_BOT_TOKEN >/dev/null 2>&1; then
  # The Claude Code "!" prompt has no keyboard input; there the token is read from the phone's clipboard (copy it first).
  if [ -t 0 ] || [ ! -x "$CLIP" ]; then
    read -rsp "Paste the bot token from @BotFather (input hidden), then press Enter: " TOKEN; echo
  else
    TOKEN=$(timeout 15 "$CLIP"); echo "Read the clipboard."
  fi
  # BotFather's whole message often gets copied with the token; take the token out of it.
  TOKEN=$(printf %s "$TOKEN" | grep -oE '[0-9]{6,}:[A-Za-z0-9_-]{30,}' | head -1)
  [ -n "$TOKEN" ] || { echo "No bot token found on the clipboard (it looks like 123456789:AA...). In @BotFather, long-press the message with the token, Copy, then TYPE the command again (don't paste it)."; exit 1; }
  NAME=$(curl -s -m 15 "https://api.telegram.org/bot$TOKEN/getMe" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['result']['username'] if d.get('ok') else '')")
  [ -n "$NAME" ] || { echo "Telegram did not accept that token. Nothing was saved."; exit 1; }
  save_secret CASHOUT_TELEGRAM_BOT_TOKEN "$TOKEN"
  [ -x /data/data/com.termux/files/usr/bin/termux-clipboard-set ] && printf '' | /data/data/com.termux/files/usr/bin/termux-clipboard-set
  echo "Saved the token for @$NAME. Next: deploy (npm run deploy), then run cashout-tgsetup again."
  exit 0
fi

TOKEN=$(gcloud secrets versions access latest --secret=CASHOUT_TELEGRAM_BOT_TOKEN)
API="https://api.telegram.org/bot$TOKEN"
# The live server answers 401 here once it has the bot turned on; 404 means it hasn't been deployed with the token yet.
CODE=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$SITE/telegram/webhook" -H 'content-type: application/json' -d '{}')
[ "$CODE" = "401" ] || { echo "The live server doesn't have the bot on yet (got HTTP $CODE). Deploy first, then run this again."; exit 1; }
SECRET=$(printf %s "cashout-telegram-webhook:$TOKEN" | sha256sum | cut -d' ' -f1)
# One retry: a phone connection sometimes drops a reply, and every one of these calls is safe to repeat.
post() {
  local r; for try in 1 2; do r=$(curl -s -m 20 -X POST "$API/$1" -H 'content-type: application/json' -d "$2"); [ -n "$r" ] && break; sleep 3; done
  printf %s "$r" | python3 -c "import json,sys
try: d=json.load(sys.stdin); print('  $1:', 'ok' if d.get('ok') else d.get('description'))
except Exception: print('  $1: no answer from Telegram (run it again)')"
}
post setWebhook "{\"url\":\"$SITE/telegram/webhook\",\"secret_token\":\"$SECRET\",\"allowed_updates\":[\"message\",\"edited_message\"],\"drop_pending_updates\":true}"
# /myid still works (it's how the owner finds their ID) but stays out of the menu.
post setMyCommands '{"commands": [{"command": "check", "description": "💸 Check a casino, game bot or wallet before you deposit"}, {"command": "help", "description": "❓ What I check and where the data comes from"}]}'
post setMyShortDescription '{"short_description": "Paste a casino, game, Telegram game bot or wallet. See the known ways people lose money there. Free."}'
post setMyDescription '{"description": "💸 Will it ever let you cash out?\n\nPaste an online casino or play-and-earn game link, a Telegram game bot, or a wallet they told you to pay. I check for the known ways people lose money: fake winnings, paying to unlock a withdrawal, copied licences, throwaway sites, balances that only exist on your phone.\n\nFree. Every finding names its source. \"No known traps found\" never means safe."}'
NAME=$(curl -s -m 15 "$API/getMe" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['username'])")
echo "Done. Your bot: https://t.me/$NAME  (send it /myid, then: cashout-tgsetup owner <that number>)"
