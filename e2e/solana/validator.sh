#!/usr/bin/env bash
# Starts solana-test-validator with pump.fun's real programs and mainnet accounts (fixtures/) and
# waits until it answers. Usage: e2e/solana/validator.sh <ledger dir> [extra validator args]
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/fixtures"
ledger="${1:-/tmp/splidev-ledger}"
shift || true
args=()
for f in "$dir"/programs/*.so; do
  id=$(basename "$f" .so)
  case "$id" in Token*) continue ;; esac # the validator ships the token programs
  args+=(--upgradeable-program "$id" "$f" none)
done
for f in "$dir"/accounts/*.json; do args+=(--account "$(basename "$f" .json)" "$f"); done
solana-test-validator --ledger "$ledger" --reset --quiet "${args[@]}" "$@" > "$ledger.log" 2>&1 &
for _ in $(seq 1 90); do
  solana -ul cluster-version > /dev/null 2>&1 && exit 0
  sleep 2
done
cat "$ledger.log"
exit 1
