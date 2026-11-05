# How the system works

## The idea in four lines

- A user holds USDC inside `intents.near`, funded from any chain.
- They buy an option ("BTC above $110k on Nov 27") from our market maker with one signature.
- At expiry a TEE oracle fixes the price: the median of 7 major exchanges.
- After the dispute window they're paid into the same balance and can withdraw to any chain.

## Services

| Service | Code | What it does | Why it exists | Who runs it |
|---|---|---|---|---|
| Options contract | `contracts/options` | Holds collateral, mints option tokens, settles, pays out | The rules and the money. Everything else is replaceable | NEAR (deployed once) |
| `intents.near` | not ours | Holds every balance, settles trades atomically | Cross-chain deposits and withdrawals, atomic swaps, no bridge code of our own | NEAR Intents team |
| Oracle WASM | `oracle/` | Takes the median of 7 exchanges' 30-min TWAPs, cross-checked against Deribit, returns one number | No usable price oracle exists on NEAR ([oracle.md](oracle.md#why-this-design)) | OutLayer, in a TEE, when the contract asks |
| Relay | `apps/relay` | Takes quote requests, runs a short auction among market makers, submits the matched trade, relays collects | Users need a firm price, one signature and no gas; the official quote bus needs KYC and lists no option tokens | Us |
| Market maker | `apps/mm` | Writes options, quotes prices, takes the other side of every trade, hedges | Someone has to sell the options and stand behind the price | Us (anyone can run another) |
| Market lister | `apps/mm` (`list`) | Every 10 min: lists BTC/ETH calls and puts, capped 2 strike steps out, for the next 4 daily expiries (plus a 4-hourly short expiry on testnet), writes inventory into them, burns its unsold pairs after the write cutoff and redeems its shorts once prices are final | Nothing can trade until a series exists and someone has written it. Recycling keeps collateral from piling up in expired series ([mm README](../apps/mm/README.md#market-lister)) | Us (MM key) |
| Testnet proposer | `apps/mm` (`propose`) | After `expiry + oracle_window_sec`, runs the pinned oracle WASM in wasmtime and proposes its price as the manual oracle | Testnet runs without OutLayer (it stalled from 2026-10-24); this keeps testnet settling with the same oracle code. Mainnet uses OutLayer | Us (oracle key) |
| Mainnet settler | `apps/mm` (`settle`) | From `expiry + 5 min`, calls `request_settlement` for each listed `(underlying, expiry)` every 10 min until a price is proposed or `oracle_window_sec` closes. Refuses a testnet RPC | Nothing on-chain triggers OutLayer: someone has to ask and pay ([mm README](../apps/mm/README.md#mainnet-settler)) | Us (relayer key) |
| Settlement monitor | `apps/mm` (`monitor`) | Every minute: checks each proposed price against Deribit, flags expiries nobody settled, watches the NEAR reserve of the contract, the intents contract and the relayer, and pending oracle and owner changes. Settlement alerts carry the exact `near` command to fix it | A wrong price can only be overridden before `final_at`, and a missing one needs a manual proposal. Nobody notices either unless something watches ([security.md](security.md#monitoring)) | Us (read-only, no key) |
| Web app | `apps/web` | Up/Down buying, positions, collect | The product people use | Us |
| Public docs | `apps/docs` | Static user and developer docs, served under `/docs` | Users and developers need plain answers without reading the repo | Us |
| SDK | `packages/sdk` | Series ids, payout math, fee-exact trade legs, intent payloads, signing, Black-76, wire schemas | One source of truth for relay, MM and web; mirrors the contract's math | Library |

## Adding an asset

Assets are config, not code:
1. **Contract:** owner calls `add_underlying(symbol, {index, decimals, min_write})`. `index` is the Deribit index name, e.g. `sol_usdc`. No token is needed: collateral and payouts are USDC.
2. **Oracle WASM:** add one row to `MARKETS` in `oracle/src/sources.rs` (the Deribit index plus each exchange's pair name), rebuild, host, `set_oracle_wasm` (in force after `oracle_delay_sec`).
3. **Market maker, relay, web:** nothing. They read underlyings and series from the contract.

Deribit must list options on it (the market maker prices from Deribit's vol) and publish daily delivery prices for its index (08:00 expiries get no price without one), and at least 3 of the oracle's 7 exchanges must list a spot pair.

## Why the market maker exists

Options need a seller. The market maker is that seller:
1. **Creates inventory.** It locks USDC in the contract, the most each option can pay (its width), and gets long + short tokens. Nobody can buy an option until someone has written it.
2. **Prices it.** A capped Up or Down is two options, one at the strike and one at the cap, each priced with Black-76 on Deribit's volatility, plus a spread. The spread is the house's income.
3. **Takes the other side.** It sells longs to buyers and buys them back from sellers.
4. **Hedges.** Selling calls leaves it short BTC. It offsets that with a Hyperliquid perp, so it earns the spread instead of taking a view on direction. Off unless a key is set.

It can't run away with user money: every option is fully collateralized inside the contract from the moment it exists.

## How they talk

```
web ──HTTP──▶ relay ◀──WebSocket── market maker ──▶ Deribit (prices), Hyperliquid (hedge)
 │              │
 │ sign         └─ execute_intents([mm half, user half]) ──▶ intents.near ◀──▶ options contract
 └──────────────────────────────────────────────────────────▶ (user deposits, balances)
options contract ── request_settlement ──▶ OutLayer TEE ── runs oracle WASM ──▶ 7 exchanges (+ Deribit check)
```

## Flows

| Flow | Steps |
|---|---|
| Fund | 1Click deposit from any chain (mainnet; the quote goes through the relay's `POST /deposit-quote`, which adds the partner key, while token list and status come from 1Click directly) or `ft_transfer_call` into intents → USDC in the user's intents balance. Testnet: "Get 100 test USDC" in the deposit sheet → relay `POST /faucet` sends it from the relayer ([limits](../apps/relay/README.md#user-api-http-json-cors-)) |
| Write (MM) | MM signs an intents `transfer` of collateral to the contract with `{"action":"write"}` → contract mints long + short into the MM's intents balance |
| Prices | After each 2 s Deribit refresh the MM sends the relay its per-contract ask, bid and vol for every series it holds and would quote → relay `GET /marks` (best ask and bid across MMs) → the web ticket, polled every 5 s ([rfq.md](rfq.md#marks)) |
| Buy / sell to close | Web asks the relay for a quote → MMs bid → user signs their half → relay submits both halves in one `execute_intents` → USDC and option swap atomically ([rfq.md](rfq.md)) |
| Settle | From expiry + 5 min the settler (mainnet) or anyone calls `request_settlement` → OutLayer runs the oracle → price proposed → final after the dispute window ([oracle.md](oracle.md#lifecycle)) |
| Collect | Holder sends longs back with `{"action":"exercise"}`, either pre-signed at buy time (auto-collect) or via the Collect button. The relay submits it; the contract pays from locked collateral into the holder's intents balance |

## Where the money is

Always inside `intents.near`. User USDC and option tokens are intents balances. Collateral is the contract's own intents balance. Payouts are intents ledger moves. No bridges, no custody by us.

## Environments

| | Mainnet | Testnet (live) |
|---|---|---|
| Intents | `intents.near` | `intents.near-options-dev.testnet`, a copy of the exact mainnet wasm |
| Options contract | not deployed | `opt3.near-options-dev.testnet` (capped, USDC, hardened). `opt.` (uncapped) and `opt2.` are retired |
| Collateral | native USDC | mock USDC (6 decimals), owned by `near-options-dev.testnet` (the uncapped build also takes mock BTC and ETH) |
| Expiries | daily 08:00 UTC (Deribit) | every minute |
| Dispute window | 1 h | 2 min |
| Oracle | `outlayer.near` | `outlayer.testnet` ([status](oracle.md#status)); testnet settles through the proposer as the manual oracle `near-options-dev.testnet` |

Ids: `deploy/testnet.json`. Proven on testnet with the uncapped build: write → burn pair → settle → exercise → redeem, the MM `write` CLI, BTC and ETH RFQ buys, a sell-back through the hosted relay, and auto-collect.

Moving the shared environment to a new contract (last done for opt3 on 2026-10-29):

1. Collect open positions (the relay drops stored claims a new contract rejects).
2. Get the oracle WASM `url` and `sha256`: from the old contract's `get_oracle_wasm`, or from a fresh `scripts/oracle-smoke.sh` run if `oracle/` changed since. Without it the proposer has nothing to run and nothing settles.
3. `OPTIONS_ID=<new>.near-options-dev.testnet ORACLE_WASM_URL=… ORACLE_WASM_SHA256=… scripts/deploy-testnet.sh near-options-dev.testnet`.
4. Set `OPTIONS_ID` in `deploy/.env` and `deploy/env.example`, replace the old id everywhere `git grep -l <old id>` finds it, commit the rewritten `deploy/testnet.json` and redeploy the stack.

Use `https://rpc.testnet.fastnear.com`. `rpc.testnet.near.org` is deprecated and rate-limits.

## Run

| What | How |
|---|---|
| Tests, lint, builds | [AGENTS.md#commands](../AGENTS.md#commands) |
| Web with no backend | `VITE_MOCK=1 pnpm --filter @endline/web dev` |
| Settlement monitor | `NEAR_RPC_URL=… OPTIONS_ID=… pnpm --filter @endline/mm start monitor` ([mm README](../apps/mm/README.md#settlement-monitor)) |
| Mainnet settler | `NEAR_RPC_URL=… OPTIONS_ID=… RELAYER_ACCOUNT_ID=… RELAYER_PRIVATE_KEY=… pnpm --filter @endline/mm start settle` ([mm README](../apps/mm/README.md#mainnet-settler)). Not in compose: the hosted stack is testnet |
| Full stack on testnet | Below. Env meanings: [relay](../apps/relay/README.md#env), [mm](../apps/mm/README.md#env), [web](../apps/web/README.md#env) |

### Hosting

The testnet stack runs 24/7 on a single Docker host reached over SSH, behind a Cloudflare quick tunnel: no open ports, server IP hidden. Quick-tunnel URLs change on restart; a named tunnel on our own domain replaces it before judging.

| Container | Role |
|---|---|
| `web` | Caddy: serves the web build, the public docs under `/docs`, and proxies the relay's public routes on the same origin. Sets `X-Forwarded-For` from Cloudflare's `CF-Connecting-IP`. App pages are `no-cache`; hashed `/assets/*` are immutable, and a missing asset is a 404, not the SPA page |
| `relay` | `TRUST_PROXY=true`, data on the `relay-data` volume. `FAUCET=true` turns on the test USDC faucet (the relayer owns the mock USDC supply) |
| `mm` | Talks to the relay over the compose network; `/mm` is not public |
| `lister` | MM key and account: keeps series listed and stocked ([mm README](../apps/mm/README.md#market-lister)) |
| `monitor` | Read-only, no key. Also watches the intents contract's and the relayer's NEAR, and `/health` through `web` (`HEALTH_URL`) |
| `proposer` | Testnet oracle: `ORACLE_*`, defaulting to the relayer's account and key |
| `tunnel` | `cloudflared`, outbound only. Public URL: `docker compose logs tunnel` |

Each container gets only its own variables from `deploy/.env` (template: `deploy/env.example`). Images are built on a Mac and travel as tarballs (the server's Docker can't pull over SSH). Deploys, restarts, alerts and their fixes: [runbook.md](runbook.md).

### Testnet from scratch

`<root>` is the account that owns the environment: `near-options-dev` for the shared one, or yours after step 2. Keys live in `~/.near-credentials/testnet/<account>.json`; its `private_key` is what `*_PRIVATE_KEY` vars take. All `near` calls below end with `network-config testnet sign-with-legacy-keychain send`.

1. **Accounts.** Install the toolchain ([AGENTS.md](../AGENTS.md#commands)). Create one account per role (you, MM, relayer); one account for all roles also works.
   ```bash
   near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
   ```
2. **Own environment (optional).** `scripts/deploy-testnet.sh <you>.testnet` deploys the intents copy, mock USDC (you hold the whole supply), the options contract with minute timing, the BTC and ETH underlyings, and makes you the manual oracle. Safe to rerun: it skips what exists, including an options contract already at `opt.<you>.testnet`; the contract can't be upgraded, so a new version goes to a new account with `OPTIONS_ID=opt2.<you>.testnet`. It needs about 21 NEAR on `<you>`, more than the faucet gives: create extra faucet accounts and top up with `near tokens <other>.testnet send-near <you>.testnet '9 NEAR' …`. It overwrites `deploy/testnet.json`, so don't commit that unless you mean to move the shared environment.
3. **Fund intents balances.** `<root>` sends mock USDC (6 decimals) into any account's intents balance. The MM needs it for collateral and buy-backs; users need it, or get it from the relay's faucet when it runs with `FAUCET=true` and the relayer is `<root>`. The faucet is same-origin only, so the web app's button doesn't reach a relay on another port (step 6): fund with the command below.
   ```bash
   near contract call-function as-transaction usdc.<root>.testnet ft_transfer_call \
     json-args '{"receiver_id":"intents.<root>.testnet","amount":"1000000000","msg":"<account>.testnet"}' \
     prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as <root>.testnet …
   ```
4. **Register signing keys on intents** for the MM and any CLI user (the web app does this itself for NEAR wallets; EVM wallets need nothing).
   ```bash
   near contract call-function as-transaction intents.<root>.testnet add_public_key \
     json-args '{"public_key":"ed25519:…"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <mm>.testnet …
   ```
5. **Create a series.** The lister (`pnpm --filter @endline/mm start list`, MM env) keeps a rolling set listed and stocked. One-off: `scripts/demo-series.sh BTC|ETH <minutes-ahead> <strike-usd> <width-usd> call|put <usdc-units>` creates it and has the MM (from `deploy/testnet.json`) write inventory. By hand (anyone): Expiry: unix seconds on a whole minute, at least ~3 min out (the MM stops 60 s before expiry), at most 7 days. Strike and width in USDC units, whole cents; a put's width is below its strike. Only the lister's width (`listedWidth`: 2 strike steps, BTC $2,000 between ~$66.7k and $133k, ETH $40 between ~$1,333 and $3,333) gets quoted; others are listed but never tradable through the relay. Excess deposit is refunded.
   ```bash
   near contract call-function as-transaction opt.<root>.testnet create_series \
     json-args '{"underlying":"BTC","strike":"110000000000","width":"2000000000","expiry":<unix>,"kind":"call"}' \
     prepaid-gas '30 Tgas' attached-deposit '0.1 NEAR' sign-as <you>.testnet …
   ```
6. **Run relay, MM, web**, one shell each, each starting with the `export` line (values for the shared environment). Write inventory with the MM env set: `pnpm --filter @endline/mm start write <series_id> <collateral units>`.
   ```bash
   export NEAR_RPC_URL=https://rpc.testnet.fastnear.com INTENTS_ID=intents.near-options-dev.testnet \
     OPTIONS_ID=opt3.near-options-dev.testnet QUOTE_ASSET=nep141:usdc.near-options-dev.testnet

   NETWORK_ID=testnet DATA_DIR=data RELAYER_ACCOUNT_ID=<relayer>.testnet RELAYER_PRIVATE_KEY=ed25519:… \
     MM_API_KEYS=<key of 16+ chars> pnpm --filter @endline/relay start

   MM_ACCOUNT_ID=<mm>.testnet MM_PRIVATE_KEY=ed25519:… RELAY_WS_URL=ws://localhost:8080/mm MM_API_KEY=<same key> \
     pnpm --filter @endline/mm start

   VITE_RELAY_URL=http://localhost:8080 VITE_NETWORK=testnet VITE_RPC_URL=$NEAR_RPC_URL VITE_INTENTS_ID=$INTENTS_ID \
     VITE_OPTIONS_ID=$OPTIONS_ID VITE_QUOTE_ASSET=$QUOTE_ASSET pnpm --filter @endline/web dev
   ```
7. **Trade.** In the web app, or from a terminal with `apps/mm/src/smoke.ts` ([mm README](../apps/mm/README.md#run)). Use series 1–2 h out and sizes near the trade cap: minutes before expiry, small options are worth under the MM's $1 minimum, so it won't quote or buy them back. For bigger demo trades raise `MAX_TRADE_USD` and `MAX_DELTA_USD` on the testnet MM: near expiry a capped option's delta approaches one per contract.
8. **Settle.** The [proposer](../apps/mm/README.md#testnet-proposer) does it; by hand, `<root>` proposes the price from expiry + 10 min (price in USDC units):
   ```bash
   near contract call-function as-transaction opt.<root>.testnet propose_settlement \
     json-args '{"underlying":"BTC","expiry":<unix>,"price":"81594540000"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <root>.testnet …
   ```
   It's final 2 min later. The relay then submits auto-collect claims within a minute, or the user presses Collect. With OutLayer working: pin the WASM once ([oracle.md](oracle.md#hosting-a-new-wasm)), then anyone calls `request_settlement` between expiry + 5 min and expiry + 10 min.

## Maintaining the public docs

`apps/docs` is a Fumadocs site (Next.js static export). It restates `docs/` for users and developers: `docs/` and the code stay the source of truth, and the public pages must agree with them.

| What | Where |
|---|---|
| Pages | `apps/docs/content/docs/*.mdx` for users, `developers/*.mdx` for developers. Order: `meta.json` in each folder |
| Theme | `apps/docs/app/global.css` only |
| Preview | `pnpm --filter @endline/docs dev`, then http://localhost:3000/docs |
| Build | `pnpm --filter @endline/docs build`: static files, search index (`api/search`), `llms.txt` and `llms-full.txt` in `apps/docs/out` |
| Serving | The `web` image copies `out` to `/srv/docs`; Caddy serves `/docs` and `/docs/*`, with `/docs/404.html` for misses |
| Base path | `DOCS_BASE_PATH`, default `/docs`. For a `docs.<domain>` root, build with `DOCS_BASE_PATH=` and give it its own Caddy site block |

Rules:
- A change to behaviour, numbers, routes or methods updates the public page in the same PR.
- Mark testnet-only values as testnet. Write mainnet values only once they're decided in `docs/`.
- No secrets, keys or server addresses.
