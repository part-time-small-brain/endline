#!/usr/bin/env bash
set -euo pipefail

account="${1:?usage: scripts/oracle-smoke.sh <testnet-account> [index] [expiry-unix]}"
index="${2:-btc_usd}"
expiry="${3:-$(python3 -c 'import time; n=int(time.time())-300; print(n - n % 60)')}"
root="$(cd "$(dirname "$0")/.." && pwd)"
wasm="$root/target/wasm32-wasip2/release/oracle.wasm"

cargo build -p oracle --target wasm32-wasip2 --release --manifest-path "$root/Cargo.toml"
hash="$(shasum -a 256 "$wasm" | cut -d' ' -f1)"

jwt="${PINATA_JWT:?set PINATA_JWT}"
cid="$(curl -sf https://uploads.pinata.cloud/v3/files \
  -H "Authorization: Bearer $jwt" \
  -F network=public -F name="oracle-$hash.wasm" -F file=@"$wasm" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["cid"])')"
url="https://gateway.pinata.cloud/ipfs/$cid"

served="$(curl -sfL "$url" | shasum -a 256 | cut -d' ' -f1)"
[ "$served" = "$hash" ] || { echo "gateway served $served, expected $hash" >&2; exit 1; }
echo "wasm: $url (sha256 $hash)" >&2

args="$(python3 - "$url" "$hash" "$index" "$expiry" <<'PY'
import json, sys
url, sha, index, expiry = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
print(json.dumps({
    "source": {"WasmUrl": {"url": url, "hash": sha, "build_target": "wasm32-wasip2"}},
    "resource_limits": {"max_instructions": 10_000_000_000, "max_memory_mb": 128, "max_execution_seconds": 60},
    "input_data": json.dumps({"index": index, "expiry": expiry, "quote_decimals": 6, "max_dev_bps": 50}),
    "response_format": "Json",
}))
PY
)"

near contract call-function as-transaction outlayer.testnet request_execution \
  json-args "$args" prepaid-gas '300.0 Tgas' attached-deposit '0.01 NEAR' \
  sign-as "$account" network-config testnet sign-with-legacy-keychain send
