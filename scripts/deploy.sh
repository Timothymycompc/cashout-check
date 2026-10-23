#!/bin/bash
# Deploys CashOut Check to Cloud Run safely: the new version starts with no visitors, gets checked at its own address,
# and only then takes over. If a check fails, the live site keeps running untouched.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
PROJECT=x300-506418
REGION=us-central1
SVC=cashout-check
CONN="$PROJECT:$REGION:solana-pulse-db"
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
stop() { printf '\n\033[31mStopped:\033[0m %s\nYour live site was not changed.\n' "$1"; exit 1; }

echo "1/4  Checking the code"
npm test --silent >/dev/null 2>&1 || stop "Tests fail. Run npm test to see which."
ok "Tests pass"
npm run -s build >/dev/null 2>&1 || stop "The build fails. Run npm run build to see why."
ok "Build passes"
for s in CASHOUT_DATABASE_URL CASHOUT_OWNER_KEY CASHOUT_CALLER_HASH_SECRET; do
  gcloud secrets describe "$s" --project "$PROJECT" >/dev/null 2>&1 || stop "Secret $s is missing. Run: npm run setup"
done
ok "Secrets exist"

echo "2/4  Uploading and starting the new version (no visitors yet, 5-10 minutes)"
FIRST=0; gcloud run services describe "$SVC" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 || FIRST=1
EXTRA=(); [ $FIRST -eq 0 ] && EXTRA=(--no-traffic --tag candidate)
gcloud run deploy "$SVC" --source . --region "$REGION" --project "$PROJECT" --allow-unauthenticated \
  --add-cloudsql-instances "$CONN" --set-env-vars "GCP_PROJECT_ID=$PROJECT" \
  --memory 512Mi --cpu 1 --no-cpu-throttling --min-instances 0 --max-instances 3 --timeout 120 --quiet "${EXTRA[@]}" \
  || stop "Cloud Run didn't accept the new version."
URL=$(gcloud run services describe "$SVC" --region "$REGION" --project "$PROJECT" --format='value(status.url)')
TEST_URL=$URL
[ $FIRST -eq 0 ] && TEST_URL=$(gcloud run services describe "$SVC" --region "$REGION" --project "$PROJECT" --format=json | python3 -c "import json,sys; print(next(t['url'] for t in json.load(sys.stdin)['status']['traffic'] if t.get('tag')=='candidate'))")
ok "New version running at $TEST_URL"

echo "3/4  Checking the new version"
curl -sf -m 30 "$TEST_URL/health" | grep -q '"ok":true' || stop "/health doesn't answer."
ok "Health"
curl -sf -m 30 "$TEST_URL/" | grep -q "<title>CashOut Check" || stop "The page doesn't load."
ok "Page loads"
curl -sf -m 90 -X POST "$TEST_URL/api/check" -H 'content-type: application/json' -H 'x-from: deploy-test' -d '{"input":"luckquexa.com"}' | grep -q DONT_DEPOSIT || stop "A known scam site didn't come out as Don't deposit."
ok "A real check works (luckquexa.com: Don't deposit)"

echo "4/4  Making it live"
[ $FIRST -eq 0 ] && { gcloud run services update-traffic "$SVC" --region "$REGION" --project "$PROJECT" --to-latest --quiet >/dev/null || stop "Traffic switch failed."; }
ok "Live at $URL"
echo "ALL DONE"
