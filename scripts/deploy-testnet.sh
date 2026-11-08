#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: [OPTIONS_ID=…] scripts/deploy-testnet.sh <root-account>.testnet}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
res="$repo/tests/sandbox/res"
intents="intents.$root"
usdc="usdc.$root"
opt="${OPTIONS_ID:-opt.$root}"
net=(network-config testnet)
sign=(sign-with-legacy-keychain send)

exists() {
  curl -sf https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}}" \
    | python3 -c 'import json,sys; sys.exit(0 if "result" in json.load(sys.stdin) else 1)'
}

subaccount() {
  exists "$1" || near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$root" "${net[@]}" "${sign[@]}"
}

deploy() {
  near contract deploy "$1" use-file "$2" with-init-call new json-args "$3" \
    prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' "${net[@]}" "${sign[@]}"
}

call() {
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '300.0 Tgas' attached-deposit "$4" sign-as "${5:-$root}" "${net[@]}" "${sign[@]}"
}

build_of() {
  curl -sf https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"get_underlyings\",\"args_base64\":\"e30=\"}}" \
    | python3 -c 'import json,sys; print("uncapped" if b"\"asset\"" in bytes(json.load(sys.stdin)["result"]["result"]) else "capped")'
}

if exists "$opt"; then
  build="$(build_of "$opt")"
  [ "$build" = capped ] || { echo "$opt runs the uncapped build, which can't be upgraded: deploy to a new account with OPTIONS_ID=…" >&2; exit 1; }
fi

[ -f "$res/intents.wasm" ] || "$repo/scripts/fetch-sandbox-wasms.sh"
(cd "$repo/contracts/options" && cargo near build non-reproducible-wasm)

if ! exists "$intents"; then
  subaccount "$intents" '15 NEAR'
  deploy "$intents" "$res/intents.wasm" \
    "{\"config\":{\"wnear_id\":\"wrap.testnet\",\"fees\":{\"fee\":1,\"fee_collector\":\"$root\"},\"roles\":{\"super_admins\":[\"$root\"],\"admins\":{},\"grantees\":{}}}}"
fi

if ! exists "$usdc"; then
  subaccount "$usdc" '2.5 NEAR'
  deploy "$usdc" "$res/fungible-token.wasm" \
    "{\"owner_id\":\"$root\",\"total_supply\":\"1000000000000000\",\"metadata\":{\"spec\":\"ft-1.0.0\",\"name\":\"Test USDC\",\"symbol\":\"USDC\",\"decimals\":6}}"
  call "$usdc" storage_deposit "{\"account_id\":\"$intents\"}" '0.00125 NEAR'
fi

if ! exists "$opt"; then
  subaccount "$opt" '5 NEAR'
  deploy "$opt" "$repo/target/near/options/options.wasm" \
    "{\"owner_id\":\"$root\",\"intents_id\":\"$intents\",\"quote_asset\":\"nep141:$usdc\",\"quote_decimals\":6,\"dispute_window_sec\":120,\"oracle_delay_sec\":60,\"timing\":{\"period_sec\":60,\"offset_sec\":0,\"write_cutoff_sec\":60,\"oracle_window_sec\":600,\"max_horizon_sec\":604800}}"
  call "$opt" add_oracle "{\"account_id\":\"$root\"}" '1 yoctoNEAR'
fi
listed="$(near contract call-function as-read-only "$opt" get_underlyings json-args '{}' "${net[@]}" now 2>&1)"
grep -q '"BTC"' <<<"$listed" || call "$opt" add_underlying '{"symbol":"BTC","underlying":{"index":"btc_usd","decimals":8,"min_write":"1000"}}' '1 yoctoNEAR'
if [ -n "${ORACLE_WASM_URL:-}" ] && [ -n "${ORACLE_WASM_SHA256:-}" ]; then
  call "$opt" set_oracle_wasm "{\"oracle_wasm\":{\"outlayer_id\":\"outlayer.testnet\",\"url\":\"$ORACLE_WASM_URL\",\"sha256\":\"$ORACLE_WASM_SHA256\"}}" '1 yoctoNEAR'
fi

python3 - "$repo/deploy/testnet.json" "$root" "$intents" "$opt" "$usdc" <<'PY'
import json, os, sys
path, root, intents, opt, usdc = sys.argv[1:]
old = json.load(open(path)) if os.path.exists(path) else {}
roles = ("oracle", "relayer", "market_maker", "demo_user")
json.dump({
    "network": "testnet",
    "rpc_url": "https://rpc.testnet.fastnear.com",
    "owner": root,
    "intents_id": intents,
    "options_id": opt,
    "quote_asset": f"nep141:{usdc}",
    "accounts": old.get("accounts") if old.get("owner") == root else {role: root for role in roles},
}, open(path, "w"), indent=2)
PY
echo "deployed: $repo/deploy/testnet.json" >&2
