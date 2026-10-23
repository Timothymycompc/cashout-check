#!/bin/bash
# One-time setup for CashOut Check on Google Cloud (project x300-506418). Safe to run again: it skips what exists.
#   - its own database "cashout" and user on the shared Cloud SQL instance solana-pulse-db
#   - secrets in Secret Manager: CASHOUT_DATABASE_URL, CASHOUT_OWNER_KEY, CASHOUT_CALLER_HASH_SECRET
#   - Cloud Run's service account may read them
# Nothing here touches Solana Pulse's or Base Pulse's databases.
set -uo pipefail
PROJECT=x300-506418
INSTANCE=solana-pulse-db
CONN="$PROJECT:us-central1:$INSTANCE"
SA="1021990235790-compute@developer.gserviceaccount.com"
DB=cashout
DBUSER=cashout
gc() { gcloud --project "$PROJECT" "$@"; }

secret() { # name value  (only if it doesn't exist yet)
  if gc secrets describe "$1" >/dev/null 2>&1; then echo "  $1 already exists, kept"; else
    printf %s "$2" | gc secrets create "$1" --data-file=- >/dev/null && echo "  $1 created"; fi
  gc secrets add-iam-policy-binding "$1" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
}

echo "== Database"
if gc sql databases describe "$DB" --instance "$INSTANCE" >/dev/null 2>&1; then echo "  database $DB already exists"; else gc sql databases create "$DB" --instance "$INSTANCE" >/dev/null && echo "  database $DB created"; fi
if gc secrets describe CASHOUT_DATABASE_URL >/dev/null 2>&1; then
  echo "  CASHOUT_DATABASE_URL already exists, user kept"
else
  PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)
  if gc sql users list --instance "$INSTANCE" --format='value(name)' | grep -qx "$DBUSER"; then
    gc sql users set-password "$DBUSER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  else
    gc sql users create "$DBUSER" --instance "$INSTANCE" --password "$PASS" >/dev/null
  fi
  secret CASHOUT_DATABASE_URL "postgresql://$DBUSER:$PASS@/$DB?host=/cloudsql/$CONN"
fi

echo "== Keys"
secret CASHOUT_OWNER_KEY "owner_$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
secret CASHOUT_CALLER_HASH_SECRET "$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"

echo "Done. Next: npm run deploy"
