# Options contract (`contracts/options`)

NEP-245 multi-token contract plus per-series collateral accounting. near-sdk 5.29. One account, e.g. `opt.<team>.near`.

## Files

| File | Job |
|---|---|
| `lib.rs` | State, init, shared helpers |
| `series.rs` | `Series`, `OptionKind`, series id + token id encoding |
| `math.rs` | Collateral and payout math (u128 with U256 intermediates) |
| `admin.rs` | Owner config, `create_series` |
| `receiver.rs` | `mt_on_transfer`: the only entry point for intents users |
| `write.rs` | Minting long + short against collateral |
| `close.rs` | Exercise, redeem, burn pair (from intents or from our ledger) |
| `settlement.rs` | Propose / override / read settlement prices |
| `oracle.rs` | `request_settlement` via OutLayer, result callback |
| `payout.rs` | Payouts via `intents.near::mt_transfer`, delivery into intents, claimable |
| `mt.rs` | NEP-245 core: balances, supply, transfers, `mt_transfer_call` + resolve |
| `events.rs` | NEP-245 events and `near-options` events |
| `views.rs` | Read-only views |

## Init

```rust
new(owner_id, intents_id, quote_asset, quote_decimals, dispute_window_sec, oracle_delay_sec, timing: Option<Timing>)
```
Mainnet: `intents_id = intents.near`, `quote_asset = nep141:17208628…a1`, `quote_decimals = 6`, `dispute_window_sec = 3600`, `oracle_delay_sec = 86400`, `timing = None`. Testnet: see `scripts/deploy-testnet.sh` (minute timing, `dispute_window_sec = 120`, `oracle_delay_sec = 60`).

`oracle_delay_sec` (60 s to 7 days, fixed at deploy) is how long `add_oracle` and `set_oracle_wasm` wait before they take effect. Until then the old oracle set and WASM stay in force, and `get_pending_oracle_changes` shows what is coming. `remove_oracle` is immediate.

`Timing` is fixed at deploy, with no setter:

| Field | Mainnet default | Testnet demo |
|---|---|---|
| `period_sec` / `offset_sec` (expiry grid) | 86400 / 28800 (daily 08:00 UTC, Deribit) | 60 / 0 (every minute) |
| `write_cutoff_sec` | 1800 | 60 |
| `oracle_window_sec` (OutLayer requests allowed until, manual settlement opens at) | 21600 | 600 |
| `max_horizon_sec` | 180 days | 7 days |

## Series and token ids

`create_series(underlying, strike, width, expiry, kind)` is permissionless and payable. The caller attaches enough NEAR to cover the storage the series uses plus the supply and intents balance rows of its long and short token, created empty here because the first write arrives from intents with no deposit; the excess is refunded.

Every series is capped: a call (Up) pays `S−K` and a put (Down) pays `K−S`, each at most `width`. The cap is `K + width` for calls and `K − width` for puts.

Rules:
- `underlying` must be whitelisted (`add_underlying`).
- `expiry` on the timing grid (mainnet: 08:00 UTC, Deribit delivery time), in the future, within the horizon.
- `strike` and `width` in quote units per one whole underlying, each a positive whole cent. Puts need `width < strike`.
- The id is derived, never passed in: `{UNDERLYING}-{D}{MON}{YY}-{STRIKE}_{CAP}-{C|P}`, like Deribit's combo names. Fractional prices use `d` as the decimal point (`2650d5`). Expiries that aren't at 08:00 UTC (demo timing) add the time: `BTC-24OCT26T0712-110000_112000-C`. The same strike with another width is another series.

| Token | Id | Example |
|---|---|---|
| Long | series id | `BTC-27NOV26-110000_112000-C` |
| Short | series id + `-SHORT` | `BTC-27NOV26-110000_112000-C-SHORT` |
| Inside intents | `nep245:<contract>:<token id>` | `nep245:opt.team.near:BTC-27NOV26-110000_112000-C` |

Option token decimals are the underlying's `decimals` from `add_underlying`. One whole token is one contract on one whole underlying.

## Math

`unit = 10^underlying_decimals`, `K` strike, `W` width, `S` settlement price, all in quote units per whole underlying. `n` option amount. `I = min(max(S−K, 0), W)` for calls, `min(max(K−S, 0), W)` for puts.

| | Calls and puts |
|---|---|
| Collateral to write `n` | `ceil(n·W / unit)` |
| Options for collateral `c` | `floor(c·unit / W)` |
| Burn pair refund | `floor(n·W / unit)` |
| Long payout | `floor(n·I / unit)` |
| Short payout | `refund − ceil(n·I / unit)`, at least 0 |

Collateral is the quote asset (USDC) for every series, and every payout is in USDC.

Guarantees, tested in `payouts_never_exceed_collateral`:
- `long + short ≤ pair refund ≤ collateral`, each gap at most 1 unit.
- A price past the cap pays exactly what the cap pays.
- Splitting a position never pays more than closing it in one go.

Any intermediate over u128 panics. Vectors shared with the SDK live in `testdata/vectors.json`.

## Entry point for users: `mt_on_transfer`

Called only by `intents.near` after a signed `transfer` intent with `msg`. `sender_id` is the signer and is the owner of any output. A panic refunds the signer, so every validation failure simply panics. At most 10 tokens per call.

| `msg` | Tokens sent | Effect | Returns |
|---|---|---|---|
| `{"action":"write","series_id":"…"}` | exactly one: the quote asset | Mint `n` long + `n` short, deliver to the sender's intents account | unused collateral |
| `{"action":"exercise"}` | long tokens (`nep245:<us>:…`) | Pay long payouts | zeros |
| `{"action":"redeem"}` | short tokens | Pay short payouts | zeros |
| `{"action":"burn_pair"}` | `[long, short]` of one series, equal amounts | Pay pair refund, any time | zeros |

Writes close `timing.write_cutoff_sec` before expiry (mainnet 30 min, when the oracle's TWAP window opens). Exercise and redeem need a final price. Option tokens received this way stay retired in our intents account.

Intent the user signs (write example):
```json
{"intent":"transfer","receiver_id":"opt.team.near","tokens":{"nep141:17208628…a1":"2000000000"},
 "msg":"{\"action\":\"write\",\"series_id\":\"BTC-27NOV26-110000_112000-C\"}","min_gas":"100000000000000"}
```

## Other public methods

| Method | Who | Notes |
|---|---|---|
| `exercise(token_id, amount)`, `redeem(...)`, `burn_pair(series_id, amount)` | holder on our ledger | 1 yocto. Burns from caller, pays into caller's intents account |
| `withdraw_claimable(owner_id, asset)` | anyone | 1 yocto. Retries a failed payout, always to `owner_id`, so EVM users who can't sign NEAR transactions get paid too |
| `request_settlement(underlying, expiry)` | anyone | Attach ≥ 0.01 NEAR, send with 300 TGas (less is refused). Window and checks: [oracle.md](oracle.md#contract-integration) |
| `set_oracle_wasm(oracle_wasm: {outlayer_id, url, sha256})` | owner | 1 yocto. Pins the oracle WASM from `now + oracle_delay_sec`: lowercase sha256, `https://` url. A new call replaces a pending WASM and restarts the delay |
| `propose_settlement(underlying, expiry, price)` | oracle account | 1 yocto. Manual fallback, only from expiry + `timing.oracle_window_sec` (can't pre-empt OutLayer), only for an expiry that has a series, once per key |
| `override_settlement(underlying, expiry, price)` | owner | 1 yocto. Only before `final_at`, keeps `final_at` |
| `add_oracle(account_id)` | owner | 1 yocto. The account can propose from `now + oracle_delay_sec`. Re-adding an existing oracle changes nothing |
| `add_underlying(symbol, underlying: {index, decimals, min_write})`, `remove_oracle`, `set_paused` | owner | 1 yocto. `index` is the Deribit index, `decimals` the option token's, `min_write` in option units |
| `propose_owner(owner_id \| null)` | owner | 1 yocto. Replaces any earlier proposal; `null` withdraws it |
| `accept_owner()` | proposed owner | 1 yocto. Ownership moves only now, so a typo can't lose it and a multisig or DAO proves it can call before it owns |
| NEP-245: `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`, `mt_batch_transfer_call` | holders | At least 1 yocto plus storage for any new balance row (excess refunded). `intents.near` exempt. Max 10 tokens per batch, approvals rejected. Plain transfers to `intents.near` or this contract are rejected: use `*_transfer_call`. Into `intents.near` the `msg` must be empty or an account id (a plain deposit) |

Pause blocks writes and new series only. Exits are never blocked. The dispute window is set once at deploy (60 s to 1 day): the owner can't freeze settlement or make a price final instantly.

`mt_supply` counts retired tokens too: options closed through intents stay in our intents account and are never burned. Open interest = supply minus our own intents balance of that token.

## Views

`get_config` (includes `pending_owner_id`, `oracle_delay_sec`), `get_oracle_wasm` and `get_oracles` (in force now), `get_pending_oracle_changes` (`{oracles: [[account_id, active_at]], oracle_wasm: {oracle_wasm, active_at} | null}`), `get_underlyings`, `get_series`, `list_series(from_index, limit ≤ 200)` (every series ever listed), `list_series_by_expiry(from_expiry, after_id, limit ≤ 200)` (series with `expiry ≥ from_expiry` in `(expiry, id)` order; for the next page pass the last one's `expiry` and `id` as `from_expiry` and `after_id`), `get_settlement(underlying, expiry)`, `get_claimable(account_id, asset)`, NEP-245 `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply`, `mt_token`.

## Async calls

| Call | Gas | Callback | On failure |
|---|---|---|---|
| Deliver options: `intents.near::mt_on_transfer(msg = owner)` | 30 TGas | `on_options_delivered` | Only if the call failed: tokens move from `intents.near` to the owner on our ledger. Any successful result counts as delivered |
| Settlement: `outlayer::request_execution` | 100 TGas + unused gas | `on_settlement_result` | Logs the reason and stores nothing. Lock cleared, anyone can retry |
| Payout: `intents.near::mt_transfer` + 1 yocto | 20 TGas | `on_payout` | Only if the call failed: amount becomes claimable, `payout_failed` event |
| `mt_transfer_call` to any receiver | 20 TGas + leftover gas | `mt_resolve_transfer` (5 + n TGas, no leftover). A 10-token batch fits intents' default 50 TGas `mt_withdraw`; if our call ran out of gas, intents would burn the user's options | Unused amounts refunded, capped by amount sent and receiver balance. Into `intents.near` an unreadable answer refunds nothing |

Promise results are read with `promise_result_checked` and a size cap. Callbacks never panic on bad external data.

## Events

- NEP-245 `mt_mint`, `mt_burn`, `mt_transfer` (`standard: "nep245"`, `version: "1.0.0"`).
- `near-options` `0.2.0` (series gained `width`, close events a single USDC `payout`): `series_created`, `write`, `exercise`, `redeem` and `burn_pair` (each with its USDC `payout`), `settlement_proposed`, `settlement_overridden`, `payout_failed` (`owner_id`, `asset`, `amount`: now claimable).

## Not built yet

- NEP-245 metadata views (`mt_metadata_*`).
- Sandbox coverage for exercise/redeem: the sandbox can't move time to an expiry quickly. That path is covered by unit tests, and burn pair covers the same payout path in the sandbox.
