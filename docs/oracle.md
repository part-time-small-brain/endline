# Settlement oracle

One price per `(underlying, expiry)`: the median of 7 major exchanges' 30-minute TWAPs before expiry, cross-checked against Deribit. Computed by our WASM inside an OutLayer TEE, proposed on-chain, final after a dispute window. Why not Deribit's delivery price: [decisions.md](decisions.md#2026-10-25).

## Why this design

- Pyth dropped NEAR (BTC frozen since 2026-08-25); Pyth Benchmarks needs a paid key.
- `priceoracle.near` (Burrow legacy) returns `null` prices. Switchboard shut down. RedStone and Chainlink have no NEAR feeds.
- OutLayer's `price-oracle.near` is spot-only: no fixing at a past timestamp.
- OutLayer runs our pinned WASM in Intel TDX and returns the result in the same tx (yield/resume). Live on mainnet and testnet, and a hackathon partner.
- The TEE is not enforced on-chain: OutLayer's operator holds full-access keys and attestation is checked off-chain. A wrong price is possible, so the dispute window is not optional.

## Lifecycle

```
E        series expiry (mainnet: 08:00:00 UTC)
E-cut    writes close, MM stops quoting (timing.write_cutoff_sec; mainnet 30 min = TWAP window start)
E+5m     request_settlement(u, E)   anyone (mainnet: our settler, every 10 min), attaches 0.01 NEAR, until E + timing.oracle_window_sec
           -> outlayer.request_execution(pinned wasm, input {index, expiry}) -> on_settlement_result
           -> Proposed { price, final_at = now + dispute window }
window   owner may override the price until final_at (final_at never moves)
final_at price is final; exercise / redeem open
E+window no price yet: oracle account proposes manually (mainnet 6 h, testnet 10 min), same dispute window
```

Until a price is final the series is pending. Nothing pays out, but `burn_pair` always works, so nobody is stuck.

## What the WASM computes

Code: `oracle/src/lib.rs` (pure logic, tested on recorded responses in `oracle/tests/fixtures`), `oracle/src/sources.rs` (endpoints, parsing), `oracle/src/main.rs` (WASI stdin/stdout + HTTP).

Input `{"index":"btc_usd","expiry":<unix sec>,"quote_decimals":6,"max_dev_bps":50}`. Output (about 370 bytes; OutLayer's limit is 900) for 2026-10-23:
```json
{"ok":true,"index":"btc_usd","expiry":1792742400,"price":"81593524333","source":"cex_twap_median",
 "deribit":81594.54,"cex_median":81593.52433333333,"usdt_usd":0.99862667,
 "venues":{"binance":81596.72,"bitfinex":81698.2,"bitstamp":81593.52,"bybit":81593.08,"coinbase":81587.42,"kraken":81590.36,"okx":81600.56}}
```
`price` is in quote units (USDC, 6 decimals), ready for the contract.

1. Per venue, a 30-minute TWAP of 1-minute closes over `[E-1800, E)`. Candles deduped by timestamp, on the minute, finite and positive. A venue counts with at least 25 candles.

   | Venue | Pair | Quote |
   |---|---|---|
   | Coinbase | BTC-USD / ETH-USD | USD |
   | Kraken | XBTUSD / ETHUSD | USD |
   | Bitstamp | btcusd / ethusd | USD |
   | Bitfinex | tBTCUSD / tETHUSD | USD |
   | Binance (`data-api.binance.vision`) | BTCUSDT / ETHUSDT | USDT |
   | OKX | BTC-USDT / ETH-USDT | USDT |
   | Bybit | BTCUSDT / ETHUSDT | USDT |

2. USDT venues convert to USD with a USDT/USD TWAP over the same window: the average of Coinbase USDT-USD and Kraken USDTUSD, only if both answer and sit within 20 bps of each other, so one tampered rate can move it at most 10 bps. Otherwise, or outside 0.97–1.03, USDT venues drop out and the 4 USD venues still give a median.
3. `m` = median of valid venue TWAPs, only with at least 3 venues. One manipulated venue can't move it.
4. `d` = the Deribit `public/get_delivery_prices` row whose `date` is the expiry date, only for 08:00 UTC expiries. A veto only, never the price. Never "latest". Always `www.deribit.com`, never `test.deribit.com` (different prices).
5. Result:
   - `m`, and `d` within `max_dev_bps` (50) of it → `m` (source `cex_twap_median`); off 08:00 UTC there is no `d` and `m` stands alone;
   - an 08:00 UTC expiry without `d` → `ok: false` (`deribit unavailable`): the check can't be skipped by blocking Deribit. The settler retries every 10 min, then manual settlement applies;
   - `d` more than 50 bps from `m` → `ok: false` (`sources disagree`), nothing is written, manual settlement applies;
   - no `m` → `ok: false` (`no data`), even with `d`. Deribit alone never settles.
6. Refuses to run before `E + 60s`; rejects quote decimals above 9.

Measured for 2026-10-23 (BTC): the 7-venue median was 0.1 bp from Deribit. Bitfinex sat +12.7 bp (its USD trades at a premium); the median ignores it. Gemini isn't used: its candle API only serves recent data, so a past window can't be reproduced.

## Contract integration

- `request_settlement(underlying, expiry)`, payable, anyone:
  - needs a series at that expiry, `E + 300 ≤ now < E + oracle_window_sec`, no existing proposal, no request in flight (a stale lock clears after 10 min);
  - attach at least 0.01 NEAR (a run costs about 0.0012; OutLayer refunds the rest to the caller, set as `payer_account_id`), send with 300 TGas (less is refused, so nobody can send a request that fails at OutLayer just to hold the lock and push an expiry to the manual path);
  - calls `request_execution` with source `WasmUrl { url, hash, build_target: "wasm32-wasip2" }`, explicit `resource_limits` (without them OutLayer only compiles), response format `Json`;
  - the yield times out after 200 blocks (about 2 min); OutLayer then returns `null`.
- `on_settlement_result`, private, never panics:
  - releases the lock only if it belongs to this request;
  - reads the result with a size cap; `null` or junk = failure, logged, nothing stored;
  - requires `ok`, the echoed `index` and `expiry`, and `price > 0`, then stores the proposal with its `source`.
- `propose_settlement` (whitelisted oracle account) is the manual fallback, from `E + oracle_window_sec`.
- Accounts: `outlayer.near` / `outlayer.testnet`. The Deribit `index` is stored per underlying.

## Hosting a new WASM

1. `scripts/oracle-smoke.sh <you>.testnet` builds the WASM, uploads it to IPFS via Pinata, checks the gateway serves the exact bytes, prints `url` and `sha256`, and runs it once on `outlayer.testnet`. Needs a Pinata JWT (`PINATA_JWT` or macOS Keychain, see [resources.md](resources.md#accounts-and-secrets-never-in-the-repo)) and the account key in the legacy keychain. Not FastFS: `test.fastfs.io` returned 502. Default expiry: 5 min ago; pass an 08:00 UTC expiry less than ~11 h old to test the Deribit check.
2. Owner pins it: `set_oracle_wasm({"oracle_wasm":{"outlayer_id":"outlayer.testnet","url":"…","sha256":"…"}})` with 1 yocto. It is used from `oracle_delay_sec` later ([contract.md](contract.md#init)).

## Status

| Item | State |
|---|---|
| Pinned WASM | `bafybeihm4qbofrnolgcyxle75u3rqv3pjn5vev5cgjezag7ng42dr6jxw4` (sha256 `259a7937…8340`), set on `opt3.near-options-dev.testnet` |
| OutLayer testnet | Stalled from 2026-10-24, working again by 2026-10-29: the pinned WASM runs there with all 7 venues reachable (BTC and ETH, checked 2026-10-29). Mainnet `outlayer.near` is live. Testnet still settles through the proposer below |
| Testnet proposer | `apps/mm` `propose` (refuses a mainnet RPC): downloads the WASM the contract pins (30 s timeout), keeps it in a private temp folder, checks its sha256 on download and again every minute before running it, runs it in wasmtime with only `PATH` in its environment and the host time passed as `--env NEAR_BLOCK_TIMESTAMP` and calls `propose_settlement` as the manual oracle once `oracle_window_sec` has passed. Same code and sources as OutLayer, minus the TEE attestation, so the dispute window and monitor are the safeguard |

On stage: show the attestation link (`outlayer-verify tx <hash>`) next to the settled price.
