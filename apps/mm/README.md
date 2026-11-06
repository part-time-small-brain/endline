# Market maker

Quotes option series to the RFQ relay, signs its `token_diff` leg with NEP-413, tracks inventory and risk, and delta-hedges on Hyperliquid. Why it exists: [Architecture](https://docs.endline.trade/developers/architecture). Trade protocol: [Relay API](https://docs.endline.trade/developers/relay-api).

## Run

```bash
pnpm --filter @endline/mm start                                   # quote
pnpm --filter @endline/mm start write <series_id> <collateral>    # write inventory
pnpm --filter @endline/mm start list [--once]                     # list series, write and recycle inventory
pnpm --filter @endline/mm start positions                         # balances, greeks, net delta
pnpm --filter @endline/mm start monitor [--once]                  # settlement, reserve, pending admin change and uptime alerts
pnpm --filter @endline/mm start settle [--once]                   # mainnet: request OutLayer settlements
pnpm --filter @endline/mm start propose [--once]                  # testnet: run the pinned oracle WASM and propose prices
pnpm --filter @endline/mm test
pnpm --filter @endline/mm typecheck
```

Before quoting, the MM account needs its key registered on the verifier (`add_public_key`), USDC in its intents balance, and written inventory for each series it should quote. Steps: [Running locally](https://docs.endline.trade/developers/running-locally#full-stack-on-testnet).

`write` signs a `transfer` intent that sends `<collateral>` (integer USDC units) to the options contract with `{"action":"write"}`, simulates it, and submits `execute_intents` from `MM_ACCOUNT_ID`, which pays the gas.

Act as a user against a running relay (nep413, so the user key must be registered on the verifier too):

```bash
USER_ACCOUNT_ID=… USER_PRIVATE_KEY=ed25519:… NETWORK_ID=testnet \
  pnpm --filter @endline/mm exec tsx src/smoke.ts <relay-url> <series_id> buy|sell|collect|claim <size>
```

The RPC and contract ids come from `deploy/<NETWORK_ID>.json`. `buy` and `sell` sign a session first ([Relay API](https://docs.endline.trade/developers/relay-api#a-trade)). `collect` sends an exercise to the relay's `/execute`, `claim` stores one valid for 7 days at its `/claims` for auto-collect.

## Env

Read from the process environment.

| Var | Meaning |
|---|---|
| `RELAY_WS_URL` | Relay MM socket, e.g. `ws://localhost:8080/mm`. Quoting only |
| `MM_API_KEY` | One of the relay's `MM_API_KEYS`, sent as `Authorization: Bearer <key>`. Quoting only |
| `MM_ACCOUNT_ID` | Signer of quotes and writes |
| `MM_PRIVATE_KEY` | `ed25519:…` key registered for `MM_ACCOUNT_ID` on `intents_id` |
| `NETWORK_ID` | `mainnet` or `testnet`, every command but `settle`. Picks `deploy/<NETWORK_ID>.json`, the only source of `rpc_url`, `intents_id` (the verifier; the monitor watches its NEAR) and `options_id`. No file (mainnet today): the command won't start. The monitor also uses it in the printed `near` commands |
| `HL_PRIVATE_KEY` | Optional `0x…` Hyperliquid key. Unset: hedges are only logged, never sent. Trades on Hyperliquid testnet unless the NEAR RPC is mainnet |
| `HL_ACCOUNT_ADDRESS` | Optional `0x…` account whose positions are hedged. Set it when `HL_PRIVATE_KEY` is an API (agent) wallet: positions live on the main account, not the agent's own address. Default: the key's address. The account must hold only this bot's hedges: every position on it counts as one, and a coin with no option market (no spot price) fails the hedge |
| `SPREAD_VOL_POINTS` | Vol shock priced into each side, default `2` |
| `MIN_PREMIUM_USD` | Default `1`. Asks are floored to it, bids below it are refused |
| `MAX_TRADE_USD` | Max payout (contracts × width) per quote, default `2000` |
| `MAX_SERIES_USD` | Max net short/long payout per series, default `5000`. The lister stocks at most this much per series |
| `MAX_DELTA_USD` | Max net delta per underlying right after a fill, before its hedge, default `50000`. Near expiry a full `MAX_TRADE_USD` trade near the money is up to `MAX_TRADE_USD × spot / width` of delta (~$80k for BTC) and gets refused; demo-size trades fit. Also each hedge order's size limit |
| `MAX_VEGA_USD` | Max net vega per vol point, default `200` |
| `ALERT_WEBHOOK_URL` | Optional. Monitor only: POSTs each `ALERT`/`RESOLVED`/`FINAL` line as `{"text","content"}` (Slack and Discord incoming webhooks) |
| `HEALTH_URL` | Optional. Monitor only: the relay's `/health`, directly or through the web origin, checked every minute (`uptime`, `quotes` alerts) |
| `RELAYER_ACCOUNT_ID` | The relay's gas payer. Monitor: optional, watches its NEAR. Settler: required, signs and pays the requests |
| `RELAYER_PRIVATE_KEY` | Settler only: the relayer's full-access `ed25519:…` key (a function-call key can't attach the deposit) |

`monitor` needs only `NETWORK_ID` and the monitor vars: no account, no key.

Fixed constants (not env): Hyperliquid taker fee 4.5 bps, carry 7 % a year on the USDC locked, hedge band $50, max Deribit data age 10 s, quote lifetime 25 s.

## How it quotes

On every relay `quote` event the bot refuses unless all of these hold:
- no kill switch is tripped;
- the auction (`deadline_ms`) is still open;
- the series exists on the contract with the same terms, the assets are its long token and the contract's `quote_asset`, and `fee_pips` equals the verifier's `fee`;
- the series' width is the lister's (`listedWidth`), so a third party's copy of a strike at another width is never quoted;
- the quote deadline (now + 25 s) is before `expiry − timing.write_cutoff_sec`;
- the Deribit data is fresh;
- the premium is below the most the size can pay (`floor(size·W/unit)`), which the $1 minimum can otherwise exceed;
- size, series, delta and vega caps hold with every outstanding quote counted as filled;
- the MM's intents balance covers the gross leg after reserving it for every outstanding quote.

Pricing is Black-76 on Deribit's `underlying_price` and `mark_iv` (`get_book_summary_by_currency` and `get_index_price` per underlying every 2 s). A capped series is two options: long at the strike `K`, short at the cap (`K + W` for Up, `K − W` for Down), each with its own vol, `σ` at `K` and `σcap` at the cap. Vols come from the nearest Deribit expiry, interpolated in log-moneyness (a listed strike gets its own vol); the forward is the Deribit index unless that expiry is listed.

- Scenarios: both vols ± spread, and each vol moving spread / 2 the opposite way (σ up, σcap down, and the reverse).
- Hedge = |delta| × forward × the Hyperliquid fee: the trade one fill causes.
- Ask = the highest scenario + 2 × hedge (now and the close at expiry) + carry, at least `MIN_PREMIUM_USD`, rounded up to quote units.
- Bid = the lowest scenario − hedge, rounded down.

After each Deribit refresh the bot sends the relay its [marks](https://docs.endline.trade/developers/relay-api): the same ask and bid for one whole option, before the $1 minimum, and `σ`, for every series it holds long or short tokens of that passes the checks above that don't depend on the quote (kill switch, width, deadline before the write cutoff, fresh data) and whose ask converts to quote units below the width, ranked by what its tokens there are worth at that bid and ask and cut off under the relay's 64 KB frame limit, so tokens others send it can't push its own series out cheaply. It publishes after every refresh, also one that failed for some underlying, so the others keep their marks.

The leg comes from the SDK's `buyDiffs`/`sellDiffs`. The nonce is versioned, uses the verifier's `current_salt` and the same deadline.

A reservation is released only when a balance read that started 3 s after its deadline comes back, whatever the relay reports: the signed leg stays fillable until then, so a relay that lied about `expired` could otherwise gather legs past the caps. So each of the series, delta and vega caps is checked against the confirmed balances plus the new trade plus every pending leg that pushes the same way, in both directions: the cap holds whichever pending legs fill. A settled trade counts in both its balance and its reservation for about 30 s, which only makes quoting stricter. A read that started before the last applied one is dropped, so a trade that settled while the relay was unreachable can't be quoted twice.

## Hedging and kill switches

Every 30 s, and after each `settled` fill, the bot sets the Hyperliquid perp per underlying to minus the option delta. Orders are IOC at mid ± 0.5 %, only when the gap is at least $50, and each at most `MAX_DELTA_USD` worth. If filled orders leave the position it reads back unchanged on two rebalances in a row (wrong `HL_ACCOUNT_ADDRESS`; one lagging read is tolerated), hedging stops and the `hedge` kill switch halts quoting until a restart. Without `HL_PRIVATE_KEY` the order is logged and a virtual position is tracked instead.

| Position | Delta per contract |
|---|---|
| long Up | `N(d1 at K) − N(d1 at K + W)` |
| long Down | `N(d1 at K) − N(d1 at K − W)`, negative |
| short | minus the long's delta |
| unsold pair | 0 (the collateral is USDC) |

Quoting stops while:
- two hedges in a row have failed (cleared by the next success);
- hedged net delta or net vega is over its cap after a hedge.

Stale data refuses each quote on its own. SIGINT/SIGTERM closes the relay socket and stops all timers; already-signed quotes stay valid until their deadline (25 s at most).

## Market lister

`list` uses the same env as `write` (MM account and key; `MAX_SERIES_USD` caps the per-series target). Every 10 min (`--once`: one pass, then exit), and on start, it reads the contract's config, underlyings and series, the Deribit index per underlying, and the MM's intents balances, then acts. One log line per action; a failed read or transaction is logged and retried next pass. The MM pays its own gas; actions are 3 s apart (RPC rate limits).

| Step | What |
|---|---|
| Expiries | Next 4 daily 08:00 UTC expiries still writable 10 min from now (`expiry − write_cutoff_sec > now + 600`) and within `max_horizon_sec`. If `period_sec` < 1 day (testnet), also the next 4-hourly expiry (00, 04, …, 20 UTC) at least 90 min out, unless it is a daily. All on the contract's grid |
| Strikes | Step = largest 1/2/5×10^n at most 1.5 % of spot (BTC $80k → $1,000, ETH $2,350 → $20). Dailies: 5 strikes around spot; short expiry: the strike either side of spot. Calls and puts, width 2 steps of the strike's own grid (`listedWidth` in the SDK: BTC $2,000, ETH $40), so a strike keeps its id when spot re-centres; puts whose width would reach the strike are skipped |
| Create | `create_series` for each missing one, 30 TGas, 0.05 NEAR attached (storage is charged, the rest refunded) |
| Write | Per listed target, top long inventory up to `min(MAX_SERIES_USD, $500)` of max payout, if the gap is at least the underlying's `min_write`. Collateral is `ceil(n·W)` USDC. Nearest expiry and strike first, never spending the last $500 of USDC |
| Burn | From `expiry − write_cutoff_sec`, burn the MM's unsold pairs (`min(long, short)`) with `burn_pair`: one intent per series |
| Redeem | Once a series' price is final, redeem the MM's shorts beyond its pairs, up to 10 per intent |

Burn and redeem cover series that expired up to 7 days ago. Unpaired longs (bought back from users) are not exercised. A write the contract refuses after the intent executes (e.g. writes just closed) is refunded by intents and still logs its tx; the next pass sees the unchanged balance.

## Settlement monitor

`monitor` checks every minute (`--once`: one check, then exit) and logs `ALERT …` lines, each posted to `ALERT_WEBHOOK_URL` if set. An alert is sent once. When its condition clears, `RESOLVED <key>` is sent, and only after that can the alert fire again. A `settle` alert still open when its price goes final sends `FINAL <key>` instead: check the final price, it can no longer be overridden. A failed post is retried (and logged again) each minute while its condition lasts; an alert that clears before any post got through is dropped. State is in memory: `--once` never retries or resolves, and a restart re-sends every active alert. A failed RPC read skips the whole check, uptime included.

| Alert | When | Prints |
|---|---|---|
| `settle` | Proposal before `final_at` that is off the reference (measured against the lower price) by more than 20 bps, the same tolerance as the oracle's Deribit veto; or that has no reference (Deribit down or no data) | `override_settlement` with `<price>` to fill in (derive it from the [oracle rules](https://docs.endline.trade/developers/oracle#what-it-computes), never paste Deribit), signed by the owner |
| `missing` | No proposal at expiry + `oracle_window_sec` | `propose_settlement` with `<price>` to fill in, signed by the first `get_oracles` account |
| `reserve <account>` | `amount − storage_usage × 10^19` yocto below 2 NEAR, for the options contract, `intents_id` and `RELAYER_ACCOUNT_ID` each | |
| `uptime` | `HEALTH_URL` set and it doesn't answer `200` with `{"ok":true}` within 5 s | The URL and the error |
| `quotes` | `/health` answers with `market_makers: 0`: no MM connected, so nobody gets a quote. Stays open while `uptime` is | |
| `pending oracle <account> <active_at>`, `pending wasm <sha256> <active_at>`, `pending owner <account>` | Each entry of `get_pending_oracle_changes` and `get_config.pending_owner_id`. Resolves once it takes effect or is withdrawn. `pending` alone: the views can't be read and no `pending` alert is open (open ones stay open). | What changes and when: `active_at` as a date, the owner on `accept_owner` |

Reference price per `(underlying, expiry)`, from the underlying's Deribit index:
- 08:00 UTC expiries: Deribit's delivery price for that date (`get_delivery_prices`, last 30 days), the same number the oracle vetoes against.
- Any other expiry (testnet minutes): mean of the 1-minute Deribit index points in (expiry − 30 min, expiry], at least 25 of them (`get_index_chart_data`, last 24 h).

The oracle settles every expiry on the median of 7 exchanges' 30-min TWAPs, so the reference is an independent second source: close, not equal.

Expiries are read one at a time. Deribit is asked only for expiries with a proposal or past the oracle window, once per index per check. Expiries whose price is final are not read again.

## Testnet proposer

`pnpm start propose [--once]` (env: `NETWORK_ID`, `ORACLE_ACCOUNT_ID`, `ORACLE_PRIVATE_KEY` (full-access: `propose_settlement` takes 1 yocto), optional `WASMTIME`). Every minute it reads the contract's `get_oracle_wasm` (none pinned yet: skips the minute), downloads it (30 s timeout) when the pin changes or the cached file no longer matches, and refuses it unless its sha256 matches, then runs it for each expiry past `expiry + oracle_window_sec` (up to a day old) with no price yet, and calls `propose_settlement` with the fixing. Needs `wasmtime` on `PATH` (the Docker image ships it); wasmtime gets only `PATH` from the environment, so the oracle key never reaches it. Refuses a mainnet RPC: mainnet settles through OutLayer.

## Mainnet settler

`pnpm start settle [--once]` (env: `RELAYER_ACCOUNT_ID`, `RELAYER_PRIVATE_KEY`). Takes the RPC and options contract from `deploy/mainnet.json`, so it won't start until that file exists, and refuses to start unless the RPC is on mainnet: testnet settles through the proposer. Every minute it reads the contract's series and `oracle_window_sec`; for each `(underlying, expiry)` with a series, from `expiry + 5 min` until `expiry + oracle_window_sec` (6 h), it reads `get_settlement` and, with no price yet, calls `request_settlement` (0.01 NEAR, 300 TGas; OutLayer refunds all but about 0.0012 NEAR, unless it rejects the call outright and the options contract keeps the deposit). It waits only until the tx is in a final block, not for OutLayer (a run can outlast the RPC's wait): the next try reads the outcome, and the relayer's txs on an explorer show any refusal. One try per key every 10 min, the contract's stale-lock timeout. A failed send is logged, and so is a retry: a key still without a price 10 min after its request means OutLayer failed or the contract logged `settlement rejected`. State is in memory: a restart retries at once. Past the window, the oracle proposes by hand (the monitor's `missing` alert).
