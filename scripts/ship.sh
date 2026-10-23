#!/bin/bash
# Test, save, push and deploy CashOut Check: cashout-ship "what changed"
cd "$(dirname "$0")/.." || exit 1
step() { local name=$1; echo "== $name"; shift; "$@" || { echo "FAILED at: $name. Nothing after this step ran."; exit 1; }; }
if [ -n "$(git status --porcelain)" ]; then
  step "Run the tests" timeout 300 npm test --silent
  step "Stage the changes" git add -A
  step "Save the changes" git commit -q -m "${1:-Update}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
else
  echo "== Changes already saved"
fi
step "Push to GitHub" timeout 120 git push origin main
echo "== Deploy (5 to 15 minutes)"
timeout 1500 bash scripts/deploy.sh; ec=$?
[ $ec -eq 0 ] && echo "ALL DONE" || echo "DEPLOY FAILED (exit $ec)"
