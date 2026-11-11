#!/usr/bin/env bash
set -euo pipefail

root="${1:?usage: ORACLE_WASM_URL=… ORACLE_WASM_SHA256=… <the six *_PUBLIC_KEY vars> scripts/mainnet-plan.sh <owner>.near}"
url="${ORACLE_WASM_URL:?set ORACLE_WASM_URL (https://docs.endline.trade/developers/oracle#pinning-a-new-wasm)}"
sha="${ORACLE_WASM_SHA256:?set ORACLE_WASM_SHA256}"
mm_pk="${MM_PUBLIC_KEY:?set MM_PUBLIC_KEY, public key of MM_PRIVATE_KEY}"
settler_pk="${SETTLER_PUBLIC_KEY:?set SETTLER_PUBLIC_KEY, public key of SETTLER_PRIVATE_KEY}"
relayer_pk="${RELAYER_PUBLIC_KEY:?set RELAYER_PUBLIC_KEY, public key of RELAYER_PRIVATE_KEY}"
oracle_pk="${ORACLE_PUBLIC_KEY:?set ORACLE_PUBLIC_KEY, public key of the admin ORACLE_PRIVATE_KEY}"
relayer_backup_pk="${RELAYER_BACKUP_PUBLIC_KEY:?set RELAYER_BACKUP_PUBLIC_KEY, public key of the admin RELAYER_BACKUP_PRIVATE_KEY}"
mm_backup_pk="${MM_BACKUP_PUBLIC_KEY:?set MM_BACKUP_PUBLIC_KEY, public key of the admin MM_BACKUP_PRIVATE_KEY}"
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
if "result" in r: print((int(r["result"]["amount"]) - r["result"]["storage_usage"] * 10**19) // 10**21)
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
[ "$balance" -ge 12100 ] || fail "$root has $balance milliNEAR above storage, needs 12100"
[ "$(near_balance "$opt")" -eq -1 ] || fail "$opt already exists: the contract is not upgradeable, pick a new account"
[ "$(decimals "$usdc")" = 6 ] || fail "$usdc is not 6 decimals"
keys=("$mm_pk" "$settler_pk" "$relayer_pk" "$oracle_pk" "$relayer_backup_pk" "$mm_backup_pk")
for pk in "${keys[@]}"; do [[ $pk =~ ^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || fail "$pk is not an ed25519:<base58> public key"; done
[ "$(printf '%s\n' "${keys[@]}" | sort -u | wc -l)" -eq 6 ] || fail "the six public keys must all differ"
(cd "$repo/contracts/options" && cargo near build reproducible-wasm >&2)
[ "$(wc -c <"$wasm")" -le 440000 ] || fail "$wasm is over 440 KB: raise the contract's 4.8 NEAR below"
echo "preflight ok. Contract $(git -C "$repo" rev-parse --short HEAD), wasm sha256 $(shasum -a 256 "$wasm" | cut -d' ' -f1)" >&2

net="network-config mainnet"
send="$net sign-with-legacy-keychain send"
admin() { echo "$net sign-with-plaintext-private-key \"\$$1\" send"; }
create() {
  local balance
  balance="$(near_balance "$1")"
  if [ "$balance" -eq -1 ]; then
    echo "near account create-account fund-myself $1 '$2 NEAR' use-manually-provided-public-key $3 sign-as $root $(admin OWNER_PRIVATE_KEY)"
  else
    echo "# $1 exists: needs ~$2 NEAR and full access for $3"
  fi
}
call="near contract call-function as-transaction"
view="near contract call-function as-read-only"
echo "# Run every command below in a shell that holds the endline-admin keys (OWNER_PRIVATE_KEY, ORACLE_PRIVATE_KEY,"
echo "# RELAYER_BACKUP_PRIVATE_KEY, MM_BACKUP_PRIVATE_KEY) as env vars, never typed or echoed."
echo "# 0. One account per role. Admin keys (endline-admin, humans only) give full access to $root, $oracle, $relayer and $mm;"
echo "#    server keys were generated on the server and only their public halves are used here."
echo "#    The monitor alerts below 2 NEAR above storage on the relayer and the MM: the relayer only pays gas, the MM also about 1 NEAR of series storage"
create "$relayer" 2.5 "$relayer_backup_pk"
create "$mm" 3.5 "$mm_backup_pk"
create "$settler" 1 "$settler_pk"
create "$oracle" 0.2 "$oracle_pk"
echo "# The relay only sends execute_intents: its RELAYER_PRIVATE_KEY is this function-call key; the admin backup key keeps full access"
echo "near account add-key $relayer grant-function-call-access --allowance unlimited --contract-account-id intents.near --function-names execute_intents use-manually-provided-public-key $relayer_pk $(admin RELAYER_BACKUP_PRIVATE_KEY)"
echo "# The MM's server key signs its intents and create_series, so it needs full access; the admin backup key stays to rotate it"
echo "near account add-key $mm grant-full-access use-manually-provided-public-key $mm_pk $(admin MM_BACKUP_PRIVATE_KEY)"
cat <<EOF

# 1. Contract account. Its 4.8 NEAR (about 4.3 NEAR code storage, the rest for the settlement and payout records it stores) can't be withdrawn once step 3 deletes its keys
near account create-account fund-myself $opt '4.8 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $root $(admin OWNER_PRIVATE_KEY)

# 2. Deploy + init: owner $root, 1 h dispute window, oracle changes wait 1 day, Deribit daily timing
near contract deploy $opt use-file $(printf %q "$wasm") with-init-call new json-args '{"owner_id":"$root","intents_id":"intents.near","quote_asset":"nep141:$usdc","quote_decimals":6,"dispute_window_sec":3600,"oracle_delay_sec":86400}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' $send

# 3. Check the init, then delete every key on $opt (with one, anyone could move all collateral).
#    get_config must show owner_id $root, pending_owner_id null, dispute_window_sec 3600, oracle_delay_sec 86400, timing.period_sec 86400
$view $opt get_config json-args '{}' $net now
near account list-keys $opt $net now
near account delete-keys $opt public-keys <every key listed above, comma-separated> $send
rm ~/.near-credentials/mainnet/$opt.json

# 4. Underlying, oracle account and oracle WASM (owner, 1 yocto). The oracle and WASM are live 24 h later
$call $opt add_underlying json-args '{"symbol":"BTC","underlying":{"index":"btc_usd","decimals":8,"min_write":"1000"}}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $(admin OWNER_PRIVATE_KEY)
$call $opt add_oracle json-args '{"account_id":"$oracle"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $(admin OWNER_PRIVATE_KEY)
$call $opt set_oracle_wasm json-args '{"oracle_wasm":{"outlayer_id":"outlayer.near","url":"$url","sha256":"$sha"}}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $root $(admin OWNER_PRIVATE_KEY)

# 5. MM: register its server key on intents, then fund its intents balance with USDC (nep141:$usdc): a near-intents.org / 1Click deposit to $mm.
#    MM_PRIVATE_KEY sits on the server and can move this whole balance: fund working capital only and top it up from a wallet that never touches the server
$call intents.near add_public_key json-args '{"public_key":"$mm_pk"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as $mm $(admin MM_BACKUP_PRIVATE_KEY)

# 6. After step 3 checks out, save as deploy/mainnet.json
{"network":"mainnet","rpc_url":"https://rpc.mainnet.fastnear.com","owner":"$root","intents_id":"intents.near","options_id":"$opt","quote_asset":"nep141:$usdc","accounts":{"oracle":"$oracle","relayer":"$relayer","settler":"$settler","market_maker":"$mm"}}
EOF
