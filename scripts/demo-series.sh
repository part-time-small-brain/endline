#!/usr/bin/env bash
set -euo pipefail

underlying="${1:?usage: scripts/demo-series.sh BTC <minutes-ahead> <strike-usd> <width-usd> call|put <usdc-units>; only the width the lister uses (2 strike steps, listedWidth in the SDK) gets quoted}"
minutes="${2:?minutes ahead}"
strike="${3:?strike in USD}"
width="${4:?width in USD}"
kind="${5:?call or put}"
collateral="${6:?collateral in USDC units}"
[[ "$underlying" =~ ^[A-Z0-9]+$ && "$minutes$strike$width$collateral" =~ ^[0-9]+$ && "$kind" =~ ^(call|put)$ ]] \
  || { echo "underlying must be uppercase, kind call or put, the rest whole numbers" >&2; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
cfg="$repo/deploy/testnet.json"
field() { python3 -c 'import json, sys
value = json.load(open(sys.argv[1]))
for key in sys.argv[2:]: value = value[key]
print(value)' "$cfg" "$@"; }
opt="$(field options_id)"
mm="$(field accounts market_maker)"
now="$(date +%s)"
expiry=$((now - now % 60 + 10#$minutes * 60))

series="$(near contract call-function as-transaction "$opt" create_series \
  json-args "{\"underlying\":\"$underlying\",\"strike\":\"${strike}000000\",\"width\":\"${width}000000\",\"expiry\":$expiry,\"kind\":\"$kind\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0.1 NEAR' sign-as "$mm" network-config testnet sign-with-legacy-keychain send 2>&1 \
  | grep -A1 'return value' | tail -1 | tr -d '"')"
echo "series $series expires $(date -u -r "$expiry" +%H:%M) UTC" >&2

cd "$repo/apps/mm"
NETWORK_ID=testnet MM_ACCOUNT_ID="$mm" \
  MM_PRIVATE_KEY="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["private_key"])' "$HOME/.near-credentials/testnet/$mm.json")" \
  pnpm start write "$series" "$collateral"
