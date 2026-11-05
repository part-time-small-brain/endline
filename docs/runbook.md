# Runbook

The hosted testnet stack: what's running, how to deploy, and what to do when an alert fires. Architecture is in [system.md](system.md#hosting).

## Where things are

| What | Where |
|---|---|
| Server | A Docker host (Docker Desktop on Windows, PowerShell) reached over SSH: `ssh <server>` |
| Compose dir | `<deploy-dir>` on the server (`compose.yaml`, `.env`). Run every server command below from here: `cd <deploy-dir>` |
| Public URL | Cloudflare quick tunnel, changes whenever `tunnel` restarts ([below](#public-url)) |
| Alerts | `monitor` logs, plus `ALERT_WEBHOOK_URL` when set |
| Ids | `deploy/testnet.json`. Owner, oracle and relayer: `near-options-dev.testnet`. MM and lister: `near-options-funder-1.testnet` |

From the Mac, run any server command in one go: `ssh <server> "cd <deploy-dir>; docker compose ps"`.

## Status and logs

| Task | Command |
|---|---|
| Containers and state | `docker compose ps` (`Restarting` = crash loop, see [.env](#env)) |
| Logs of one service | `docker compose logs --tail 100 -f relay` (`mm`, `lister`, `monitor`, `proposer`, `web`, `tunnel`) |
| Errors only (PowerShell) | `docker compose logs --tail 500 lister \| Select-String -Pattern 'fail\|error'` |
| Relay up, MMs connected | `docker compose exec web wget -qO- http://localhost/health` → `{"ok":true,"market_makers":1}` (no port is published on the host) |
| Open alerts | `docker compose logs --tail 5 monitor` (`monitor: N open alerts`) |
| Account NEAR | `near account view-account-summary <account> network-config testnet now` (on the Mac) |

## Restart

| Task | Command |
|---|---|
| Restart a service, same config | `docker compose restart mm` |
| Pick up a changed `.env` | `docker compose up -d --no-build --pull never --no-deps mm` (`restart` keeps the old env) |
| Stop one | `docker compose stop lister` |

Never `docker compose down`, `restart` with no service, or `up` naming `tunnel`, unless you want a new public URL. Name the services every time.

### Public URL

```powershell
docker compose logs tunnel | Select-String trycloudflare.com | Select-Object -Last 1
```

The web app calls the relay on its own origin, so a new URL needs no rebuild: just share the new link.

## Deploy

Build on the Mac (OrbStack); the server never builds or pulls. Images go over as tarballs.

```bash
docker compose -f deploy/compose.yaml --env-file deploy/env.example build
docker save --platform linux/amd64 near-options-app near-options-web | ssh <server> docker load
scp deploy/compose.yaml <server>:<deploy-dir>/   # only if it changed
ssh <server> "cd <deploy-dir>; docker compose up -d --no-build --pull never relay mm lister monitor proposer web"
```

- `env.example` holds the testnet ids that get baked into the web build; no secrets go into an image. The `Caddyfile` is baked into `near-options-web` too: a change ships with the image.
- `.env` lives only on the server. Edit it there; never copy it.
- App containers run as the `node` user. A `relay-data` volume created before that is owned by root: once, before the first deploy that switches, run `docker compose run --rm --no-deps --user root --entrypoint chown relay -R node:node /data` on the server.
- Base images are pinned by tag and digest (`deploy/Dockerfile`, `compose.yaml`) and wasmtime by `WASMTIME` and `WASMTIME_SHA256`. To bump, take the new tag's digest from `docker buildx imagetools inspect <image>:<tag>` and the tarball's `sha256sum`.
- Restarting `relay` or `mm` may fire `uptime` or `quotes` once if a check lands in the gap: it resolves on the next check.

## Alerts

Every alert fires once, then `RESOLVED <key>` when it clears. A restart of `monitor` re-sends the open ones. The `near` commands it prints are complete: run them on the Mac with the signer's key in `~/.near-credentials`.

| Alert | Means | Fix |
|---|---|---|
| `settle` (`…: proposed X …, Deribit Y (N bps off) … Override: …`) | A proposed price is more than 20 bps from Deribit, or Deribit had no reference, and it isn't final yet | Recompute the price the oracle would give with the pinned WASM, not a local build: download `get_oracle_wasm().url`, check its `shasum -a 256` against `get_oracle_wasm().sha256`, run it with `wasmtime` (input as in AGENTS.md, this expiry) and compare its venues. Do it within ~11 h of expiry: Kraken keeps 12 h of 1-minute candles, and without it the USDT venues drop out too. Wrong: run the printed `override_settlement` as the owner before `final at` (testnet window: 2 min) with that price in USDC units in place of `<price>`. Never paste Deribit's price: it's a check, not the settlement source. Right: ignore, `FINAL` follows |
| `FINAL settle …` | A flagged price went final | Nothing can change it now. If it was wrong, write it down: payouts used it |
| `missing` (`…: no settlement after the oracle window … Propose: …`) | No price at expiry + `oracle_window_sec` | Testnet: the proposer starts at the same moment, so a `missing` that resolves within a couple of minutes is just it landing. Still open: the proposer failed, `docker compose logs --tail 100 proposer`, then `docker compose restart proposer`. Mainnet: the settler or OutLayer failed. Either way, run the printed `propose_settlement` as the oracle, with the WASM's median in USDC units in place of `<price>` |
| `reserve <account>` | That account's NEAR above storage is under 2 NEAR. Relayer: trades, collects and the faucet stop when it runs dry | [Fund it](#funding) |
| `pending oracle/wasm/owner` | An admin change is queued on the contract | Ours: nothing. Not ours: the owner key leaked. Cancel with `remove_oracle <id>` or `propose_owner null`. A WASM can't be withdrawn, only replaced: `set_oracle_wasm` with the current `get_oracle_wasm` (a new `pending wasm` alert, resolved after `oracle_delay_sec`; 60 s on testnet, usually too short to react). Then rotate the owner key |
| `pending` (`can't read pending changes`) | The views failed (RPC) | Resolves by itself; if it stays, check `NEAR_RPC_URL` |
| `uptime` (`http://web/health: down: …`) | `/health` through Caddy failed within 5 s | `docker compose ps`. `web` down: `docker compose logs --tail 50 web`. Error mentions HTTP 502: `relay` is down, `docker compose logs --tail 100 relay`. Then `docker compose up -d --no-build --pull never --no-deps relay web` |
| `quotes` (`no market maker connected`) | Relay is up, no MM on its socket: no buy or sell works | `docker compose logs --tail 100 mm`. `relay error: Unexpected server response: 401`: `MM_API_KEY` isn't in `MM_API_KEYS`. Crash loop: [.env](#env). Then `docker compose restart mm` |

Not alerted, check by hand:

| Failure | Symptom | Check |
|---|---|---|
| Lister stopped | No new series in the app, or the MM quotes nothing (no inventory) | `docker compose logs --tail 100 lister`: usually the MM is out of NEAR (0.05 NEAR per `create_series`) or collateral |
| MM out of NEAR or collateral | Writes fail in `lister`/`mm` logs | `near account view-account-summary near-options-funder-1.testnet network-config testnet now`; collateral: [system.md step 3](system.md#testnet-from-scratch) |
| `monitor` itself down | Silence | `docker compose ps monitor` |
| Failed payout | A `payout_failed` event in the options contract's logs: the amount is claimable | Anyone can retry, so repeats for one owner can be noise; `get_claimable` shows what is still owed. Retry once for the owner: `near contract call-function as-transaction <opt> withdraw_claimable json-args '{"owner_id":"<owner>","asset":"<quote asset>"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as <any account> network-config testnet sign-with-legacy-keychain send` |
| RPC down or rate-limited | `monitor: check failed` or `Rate limits exceeded` (429) in the logs, `/series` 500 once the relay has no cached listing | Switch `NEAR_RPC_URL` in `.env` (backend: `https://near-testnet.drpc.org`; fallback `https://testnet-rpc.intea.rs`; `rpc.testnet.near.org` and FastNEAR rate-limit the server, see [decisions](decisions.md)); the log says `rpc refresh failed, serving the last value` while the relay rides it out, then `docker compose up -d --no-build --pull never --no-deps relay mm lister monitor proposer` |
| A trade, collect or transfer stuck `settling` | `execute_intents errored, settling by the user's nonce` in `relay` logs, then `can't read the user's nonce yet` while the RPC is down | Nothing to do: it resolves to `settled` or `failed` once the RPC answers, and that signer's next `/execute` or `/transfer` gets `409` until then. A relay restart loses that quote's fill row (the trade itself is on-chain either way) |

## Funding

| Account | Needs | How (testnet) |
|---|---|---|
| Relayer `near-options-dev.testnet` | NEAR for gas (trades, collects, faucet, proposals). Holds the whole mock USDC supply | `near tokens <funder>.testnet send-near near-options-dev.testnet '9 NEAR' network-config testnet sign-with-legacy-keychain send` |
| MM `near-options-funder-1.testnet` | NEAR for gas and series deposits; USDC in its intents balance (collateral and buy-backs) | NEAR as above. Tokens: `ft_transfer_call` from the owner, [system.md step 3](system.md#testnet-from-scratch) |

Testnet NEAR: create a throwaway account from the faucet (`near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create`) and send its NEAR on, keeping a little for the send.

User faucet (`FAUCET=true`, "Get 100 test USDC"): once per account and per IP per 24 h, 200 sends per 24 h in total, then `429`. State: `faucet.json` on the `relay-data` volume. It stops when the relayer runs out of NEAR or mock USDC.

Mainnet: real NEAR, sent from the owner or an exchange. The deploy plan starts the relayer and MM at 3 NEAR each; the monitor watches the relayer, not the MM. No faucet, no proposer, and the settler isn't in compose: start it as in [mainnet.md](mainnet.md).

## .env

Names only; values live on the server. Template: `deploy/env.example`.

| Key | Used by |
|---|---|
| `NEAR_RPC_URL`, `OPTIONS_ID` | relay, mm, lister, monitor, proposer, web build |
| `NETWORK_ID`, `INTENTS_ID` | relay, mm, monitor, web build; `lister` takes `INTENTS_ID` only |
| `QUOTE_ASSET` | relay, web build |
| `MM_API_KEYS`, `FAUCET`, `ONECLICK_JWT` | relay |
| `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY` | relay; `monitor` watches the account; `proposer` falls back to them |
| `MM_ACCOUNT_ID`, `MM_PRIVATE_KEY` | mm, lister |
| `MM_API_KEY` | mm |
| `ORACLE_ACCOUNT_ID`, `ORACLE_PRIVATE_KEY` | proposer (optional) |
| `ALERT_WEBHOOK_URL`, `HEALTH_URL` | monitor (optional; `HEALTH_URL` defaults to `http://web/health`) |

Gotcha: a key set to an empty or invalid value crashes its service on start, and `restart: unless-stopped` turns that into a crash loop. Optional keys must be a valid value or absent: `ALERT_WEBHOOK_URL` a full `https://…` URL, `ONECLICK_JWT` non-empty, `FAUCET` `true`/`false`. `HEALTH_URL` and `ORACLE_*` are the exception: blank falls back to their default. Comment the line out instead of blanking it. `docker compose logs --tail 20 <service>` names the bad key.
