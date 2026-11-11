#!/usr/bin/env bash
set -euo pipefail

res="$(cd "$(dirname "$0")/.." && pwd)/tests/sandbox/res"
intents_rev="d340060afe1debb8c8f2f2fc6b6c999d48c886b0"
mkdir -p "$res"

curl -sf https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_code","finality":"final","account_id":"intents.near"}}' \
  | python3 -c 'import sys,json,base64; sys.stdout.buffer.write(base64.b64decode(json.load(sys.stdin)["result"]["code_base64"]))' \
  > "$res/intents.wasm.part"
mv "$res/intents.wasm.part" "$res/intents.wasm"

for name in fungible-token wnear; do
  curl -sfL "https://raw.githubusercontent.com/near/intents/$intents_rev/releases/$name.wasm" -o "$res/$name.wasm.part"
  mv "$res/$name.wasm.part" "$res/$name.wasm"
done

ls -l "$res"
