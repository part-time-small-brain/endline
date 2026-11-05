# Mainnet with dust sizes

Goal ([roadmap](roadmap.md) #5): the contract on mainnet, OutLayer settles a real expiry, one real trade and one collect. About $50 of USDC and 15 NEAR on the owner, of which the contract's 8 NEAR is spent for good. Every step below is a signed mainnet transaction: a human runs it.

## Before

| What | How |
|---|---|
| Code | A checkout of `main` with the two-step owner and oracle delay, `contracts/options` unchanged from `HEAD`. The plan builds the wasm itself (`non-reproducible-wasm`: no verifiable build yet) |
| Oracle WASM | Hosted per [oracle.md](oracle.md#hosting-a-new-wasm): `url` + `sha256`. The testnet one works: the hash pins the code, only `outlayer_id` changes |
| Owner | `<root>.near` with 15 NEAR, its key in the legacy keychain (`~/.near-credentials/mainnet/<root>.json`): `near account import-account … save-to-legacy-keychain network-config mainnet` |
| Relayer, MM | Own accounts, default `relayer.<root>.near` and `mm.<root>.near`. The plan creates them (3 NEAR each) if missing. Never the owner's key in a bot |
| Oracle | Manual fallback signer, default `<root>.near` |
| MM collateral | USDC in the MM's intents balance (plan step 5) |

## Day 0: deploy

```bash
ORACLE_WASM_URL=… ORACLE_WASM_SHA256=… [OPTIONS_ID=… ORACLE_ACCOUNT_ID=… RELAYER_ACCOUNT_ID=… MM_ACCOUNT_ID=…] \
  scripts/mainnet-plan.sh <root>.near
```

The script never signs. It checks the oracle URL serves the hash, that `contracts/options` is committed, the owner's key and balance, that the contract account is free, and USDC's decimals. It builds the wasm and prints its sha256, then prints the steps with every id filled in:

| Step | What |
|---|---|
| 0 | Create the relayer and MM accounts if missing. Their keys are `RELAYER_PRIVATE_KEY` and `MM_PRIVATE_KEY` |
| 1–2 | Create the contract account, deploy + init: 1 h dispute window, 1 day oracle delay, Deribit daily timing |
| 3 | Check `get_config` against the printed values, then delete every key on the contract account. Wrong init: stop here, nothing is locked yet |
| 4 | BTC and ETH underlyings, the oracle account, the oracle WASM. Both are live 24 h later (`get_pending_oracle_changes`) |
| 5 | MM key on intents, then MM collateral into intents |
| 6 | `deploy/mainnet.json` to commit |

## Day 1–2: trade

Once `get_oracles` and `get_oracle_wasm` return them. The first usable expiry is the next 08:00 UTC at least 2 h out, often day 2. Run the services on the Mac for this test, not on the server (compose has one project and one web image per network):

```bash
export NEAR_RPC_URL=https://rpc.mainnet.fastnear.com INTENTS_ID=intents.near OPTIONS_ID=<opt> \
  QUOTE_ASSET=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1

NETWORK_ID=mainnet DATA_DIR=data/mainnet RELAYER_ACCOUNT_ID=<relayer> RELAYER_PRIVATE_KEY=ed25519:… \
  MM_API_KEYS=<16+ chars> pnpm --filter @endline/relay start

MM_ACCOUNT_ID=<mm> MM_PRIVATE_KEY=ed25519:… RELAY_WS_URL=ws://localhost:8080/mm MM_API_KEY=<same> \
  pnpm --filter @endline/mm start

NETWORK_ID=mainnet RELAYER_ACCOUNT_ID=<relayer> ALERT_WEBHOOK_URL=… pnpm --filter @endline/mm start monitor

RELAYER_ACCOUNT_ID=<relayer> RELAYER_PRIVATE_KEY=ed25519:… pnpm --filter @endline/mm start settle

VITE_RELAY_URL=http://localhost:8080 VITE_NETWORK=mainnet VITE_RPC_URL=$NEAR_RPC_URL VITE_INTENTS_ID=$INTENTS_ID \
  VITE_OPTIONS_ID=$OPTIONS_ID VITE_QUOTE_ASSET=$QUOTE_ASSET pnpm --filter @endline/web dev
```

- No `FAUCET` (the relay refuses it on mainnet), no proposer (testnet only).
- Before hosting this anywhere reachable from the internet, split the keys: give the relay a function-call key that can only call `execute_intents` on `intents.near` (it needs nothing else once the faucet is off), and run the settler as its own account with a full-access key (`request_settlement` attaches NEAR), passed as `RELAYER_ACCOUNT_ID`/`RELAYER_PRIVATE_KEY` to `settle` only. A leaked relay key then can't move the relayer's NEAR.
- No lister: it keeps $500 of USDC back for buy-backs, so at dust sizes it writes nothing.
- Series by hand: `create_series` for that expiry ([system.md](system.md#testnet-from-scratch) step 5, `network-config mainnet`), then `pnpm --filter @endline/mm start write <series_id> <collateral units>` with the MM env.
- Make the trade collectable: buy an Up one strike step ($1,000) under spot with the lister's width (2 strike steps: $2,000 while BTC is between ~$66.7k and $133k), so the cap sits above spot. 0.001 contracts lock $2 of USDC, cost about $1–1.50 and pay about $1 if BTC holds. A deeper in-the-money Up costs about its whole $2 payout plus carry, which the MM refuses as at or above max payout. An at-the-money dust option is worth cents, the MM asks at least `MIN_PREMIUM_USD` ($1), and a zero payout can't be collected.
- The app's deposit sheet works from `pnpm dev` only if the relay lists the dev origin: `APP_ORIGINS=http://localhost:5173`. Otherwise fund the test user from near-intents.org or with `ft_transfer_call` (plan step 5)
- Trade from the web app, or `apps/mm/src/smoke.ts` ([mm README](../apps/mm/README.md#run)), which needs the user's key registered on `intents.near` (plan step 5 for that account) and USDC in their intents balance.

## Settle and collect

The settler ([mm README](../apps/mm/README.md#mainnet-settler)) calls `request_settlement` as the relayer from expiry + 5 min, every 10 min until a price is proposed or expiry + 6 h. Fallback by hand, in the same window:

```bash
near contract call-function as-transaction <opt> request_settlement json-args '{"underlying":"BTC","expiry":<unix>}' \
  prepaid-gas '300 Tgas' attached-deposit '0.01 NEAR' sign-as <root>.near network-config mainnet sign-with-legacy-keychain send
```

The monitor compares the proposal with Deribit. It's final 1 h later, then the relay submits auto-collect claims or the user presses Collect. Missed the window: the oracle account proposes by hand (the monitor's `missing` alert prints the command).

## Owner to a multisig

Before judging: create a multisig or DAO (e.g. Sputnik), then `propose_owner` from `<root>.near` and have the multisig call `accept_owner` with 1 yocto. `get_config.owner_id` shows the new owner. Until the override problem in [security.md](security.md#known-gaps-accepted-for-the-hackathon-tracked) is solved, a multisig owner has to pass any price override within the 1 h dispute window.
