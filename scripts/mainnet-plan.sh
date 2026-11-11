#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: ORACLE_WASM_URL=… ORACLE_WASM_SHA256=… scripts/mainnet-plan.sh <owner>.near}"
url="${ORACLE_WASM_URL:?set ORACLE_WASM_URL (https://docs.endline.trade/developers/oracle#pinning-a-new-wasm)}"
sha="${ORACLE_WASM_SHA256:?set ORACLE_WASM_SHA256}"
opt="${OPTIONS_ID:-opt.$root}"
oracle="${ORACLE_ACCOUNT_ID:-oracle.$root}"
settler="${SETTLER_ACCOUNT_ID:-settler.$root}"
relayer="${RELAYER_ACCOUNT_ID:-relayer.$root}"
mm="${MM_ACCOUNT_ID:-mm.$root}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
wasm="$repo/target/near/options/options.wasm"
usdc="17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"

fail() {
  echo "preflight: $*" >&2
  exit 1
}

query() {
  curl -sf https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":$1}" || fail "mainnet RPC unreachable"
}

near_balance() {
  query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}" | python3 -c '
import json, sys
r = json.load(sys.stdin)
if "result" in r: print(int(r["result"]["amount"]) // 10**24)
elif "UNKNOWN_ACCOUNT" in json.dumps(r): print(-1)
else: sys.exit(f"rpc: {r}")'
}

decimals() {
  query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"ft_metadata\",\"args_base64\":\"e30=\"}" \
    | python3 -c 'import json,sys; print(json.loads(bytes(json.load(sys.stdin)["result"]["result"]))["decimals"])'
}

[[ $url == https://* && $url != *[\'\"\ ]* ]] || fail "ORACLE_WASM_URL must be https:// without quotes or spaces"
[[ $sha =~ ^[0-9a-f]{64}$ ]] || fail "ORACLE_WASM_SHA256 must be 64 lowercase hex chars"
[ -z "$(git -C "$repo" status --porcelain -- contracts/options Cargo.toml Cargo.lock)" ] || fail "contracts/options, Cargo.toml or Cargo.lock has uncommitted changes"
[ "$(curl -sfL "$url" | shasum -a 256 | cut -d' ' -f1)" = "$sha" ] || fail "$url does not serve sha256 $sha"
balance="$(near_balance "$root")"
[ "$balance" -ge 17 ] || fail "$root has $balance NEAR, needs 17"
[ "$(near_balance "$opt")" -eq -1 ] || fail "$opt already exists: the contract is not upgradeable, pick a new account"
[ "$(decimals "$usdc")" = 6 ] || fail "$usdc is not 6 decimals"
(cd "$repo/contracts/options" && cargo near build reproducible-wasm >&2)
echo "preflight ok. Contract $(git -C "$repo" rev-parse --short HEAD), wasm sha256 $(shasum -a 256 "$wasm" | cut -d' ' -f1)" >&2

net="network-config mainnet"
send="$net sign-with-legacy-keychain send"
ledger="$net sign-with-ledger usb send"
oracle_key="use-ledger --seed-phrase-hd-path \"44'/397'/0'/0'/2'\" usb"
call="near contract call-function as-transaction"
view="near contract call-function as-read-only"
echo "# 0. One account per role. $root signs on the Ledger (default path 44'/397'/0'/0'/1'), $oracle gets the Ledger key at 44'/397'/0'/0'/2',"
echo "#    the others a full-access key in your keychain. Only three keys go on the server: the relay's function-call key (below),"
echo "#    MM_PRIVATE_KEY and SETTLER_PRIVATE_KEY. The relayer's full-access key stays offline"
for spec in "$relayer:3" "$mm:3" "$settler:1" "$oracle:0.5"; do
  account="${spec%%:*}"
  near="${spec##*:}"
  if [ "$(near_balance "$account")" -eq -1 ]; then
    key="autogenerate-new-keypair save-to-legacy-keychain"
    [ "$account" = "$oracle" ] && key="$oracle_key"
    echo "near account create-account fund-myself $account '$near NEAR' $key sign-as $root $ledger"
  else
    echo "# $account exists: needs ~$near NEAR and its key in ~/.near-credentials/mainnet/$account.json"
  fi
done
echo "# The relay only sends execute_intents: its RELAYER_PRIVATE_KEY is this function-call key, never the full-access one"
echo "near account add-key $relayer grant-function-call-access --allowance unlimited --contract-account-id intents.near --function-names execute_intents autogenerate-new-keypair save-to-legacy-keychain $send"
cat <<EOF

# 1. Contract account. Its 8 NEAR (code storage, 2 NEAR reserve, series storage) can't be withdrawn once step 3 deletes its keys
near account create-account fund-myself $opt '8 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $root $ledger

# 2. Deploy + init: owner $root, 1 h dispute window, oracle changes wait 1 day, Deribit daily timing
near contract deploy $opt use-file $(printf %q "$wasm") with-init-call new json-args '{"owner_id":"$root","intents_id":"intents.near","quote_asset":"nep141:$usdc","quote_decimals":6,"dispute_window_sec":3600,"oracle_delay_sec":86400}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' $send

# 3. Check the init, then delete every key on $opt (with one, anyone could move all collateral).
#    get_config must show owner_id $root, pending_owner_id null, dispute_window_sec 3600, oracle_delay_sec 86400, timing.period_sec 86400
$view $opt get_config json-args '{}' $net now
near account list-keys $opt $net now
near account delete-keys $opt public-keys <every key listed above, comma-separated> $send

# 4. Underlying, oracle account and oracle WASM (owner, 1 yocto). The oracle and WASM are live 24 h later
$call $opt add_underlying json-args '{"symbol":"BTC","underlying":{"index":"btc_usd","decimals":8,"min_write":"1000"}}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $ledger
$call $opt add_oracle json-args '{"account_id":"$oracle"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $ledger
$call $opt set_oracle_wasm json-args '{"oracle_wasm":{"outlayer_id":"outlayer.near","url":"$url","sha256":"$sha"}}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $ledger

# 5. MM: register its key on intents (public_key from ~/.near-credentials/mainnet/$mm.json), then fund its intents balance with USDC:
#    a near-intents.org / 1Click deposit to $mm, or ft_transfer_call if $mm holds USDC on NEAR.
#    MM_PRIVATE_KEY sits on the server and can move this whole balance: fund working capital only and top it up from a wallet that never touches the server
$call intents.near add_public_key json-args '{"public_key":"<$mm public key>"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $mm $send
$call $usdc ft_transfer_call json-args '{"receiver_id":"intents.near","amount":"<usdc units>","msg":"$mm"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as $mm $send

# 6. After step 3 checks out, save as deploy/mainnet.json
{"network":"mainnet","rpc_url":"https://rpc.mainnet.fastnear.com","owner":"$root","intents_id":"intents.near","options_id":"$opt","quote_asset":"nep141:$usdc","accounts":{"oracle":"$oracle","relayer":"$relayer","settler":"$settler","market_maker":"$mm"}}
EOF
