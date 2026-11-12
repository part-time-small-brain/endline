# RFQ relay

Runs the RFQ auction between users and market makers, settles trades with `intents.near::execute_intents([mm, user])`, and submits collects gaslessly. How a trade works: [Relay API](https://docs.endline.trade/developers/relay-api). Wire types: `packages/sdk/src/protocol.ts`.

## Run

```bash
pnpm --filter @endline/relay start
pnpm --filter @endline/relay test
pnpm --filter @endline/relay typecheck
```

At startup the relay checks that the RPC is on `NETWORK_ID` and that `options_id`'s `get_config` uses `intents_id` and `quote_asset`, and exits otherwise. Testnet values and a full-stack run: [Running locally](https://docs.endline.trade/developers/running-locally#full-stack-on-testnet).

## Env

Read from the process environment (no `.env` loading). `RELAYER_PRIVATE_KEY`, `MM_API_KEYS`, `ONECLICK_JWT` and `NEAR_RPC_URLS` can come from a file instead: set `<NAME>_FILE` to its path, not both ([Secrets](https://docs.endline.trade/developers/running-locally#secrets)).

| Var | Meaning |
|---|---|
| `PORT` | HTTP and WS port, default `8080` |
| `NETWORK_ID` | `mainnet` or `testnet`. Picks `deploy/<NETWORK_ID>.json`, the only source of `rpc_url`, `intents_id`, `options_id` and `quote_asset`. No file: the relay won't start |
| `RELAYER_ACCOUNT_ID` | Account that sends `execute_intents` and pays gas |
| `RELAYER_PRIVATE_KEY` | `ed25519:…` (or `secp256k1:…`) key of that account. A function-call key limited to `execute_intents` on `intents_id` is enough, unless `FAUCET=true`: the faucet's `ft_transfer_call` attaches 1 yocto, which needs a full-access key |
| `MM_API_KEYS` | Comma list of MM API keys, at least 16 chars each |
| `DATA_DIR` | Where `fills.jsonl`, `claims.json`, `calls.json` and `faucet.json` are written, e.g. `data` (gitignored) |
| `TRUST_PROXY` | `true` when the relay sits behind exactly one reverse proxy that appends `X-Forwarded-For`: the client IP is the last hop. Default `false` (socket address) |
| `FAUCET` | `true` turns on `POST /faucet`, dripping the `quote_asset` token the relayer holds. Testnet only: the relay refuses to start with it on mainnet. Default `false` |
| `APP_ORIGINS` | Comma list of origins (`https://app.endline.trade`, no path or trailing slash) that may call `/faucet` and `/deposit-quote` from a browser. Default none: those two routes then answer no CORS, so only a page on the relay's own origin can use them |
| `ONECLICK_JWT` | Optional 1Click Partner Portal JWT, sent as `X-API-Key` on `POST /deposit-quote`. Unset: quotes are forwarded without it and 1Click adds 0.25% to every deposit |
| `NEAR_RPC_URLS` | Optional comma list of extra RPC endpoints, tried before `rpc_url` from the deploy file: fastest healthy first, a rate limit, 5xx or timeout cools one off, one on another network is never used ([Secrets](https://docs.endline.trade/developers/running-locally#secrets)) |

## User API (HTTP, JSON, CORS `*` except `/faucet` and `/deposit-quote`)

| Route | Body → answer |
|---|---|
| `GET /health` | `{ok, market_makers}` |
| `GET /series` | `{quote_asset, quote_decimals, series: [Series + option_asset + quotable]}`. `quotable` is false from `expiry − max(timing.write_cutoff_sec, 30 min)` (`quotableUntil` in the SDK: no quotes inside the oracle's averaging window), and for a width other than the lister's (`listedWidth` in the SDK), since anyone can create the same strike with another width and no market maker stocks it. Only series that expired less than 7 days ago or later (`CLAIM_WINDOW_SEC`, also the auto-collect deadline) |
| `GET /marks` | `[{series_id, ask, bid?, max_size, vol}]` per series: the lowest ask (with that MM's `vol` and `max_size`) and highest bid across connected MMs, from marks received in the last 10 s. An MM's marks go when it disconnects ([Relay API](https://docs.endline.trade/developers/relay-api)) |
| `POST /quote` | `QuoteRequest` (with a signed `session`) → `Quote`. A buy must be at least the underlying's `min_write` (smaller sizes can't be collected gaslessly); sells of any size. A new quote expires the signer's earlier unsigned one; their quotes in auction or settling must fit their intents balance ([Relay API](https://docs.endline.trade/developers/relay-api#open-quotes)) |
| `POST /publish` | `PublishRequest` → `StatusUpdate` (200 settled, 422 failed) |
| `GET /status/:quote_id` | `StatusUpdate`. `expired` from `sign_by_ms`; forgotten after an hour (then `404`) |
| `GET /fills/:account_id` | `Fill[]` for that signer |
| `POST /execute` | `{signed}` → `{tx_hash}`. Gasless Collect. `tx_hash` is the relayer's transaction that ran, also when the send errored |
| `POST /claims` | `{signed}` → `{ok: true}`. Stores a pre-signed exercise for auto-collect |
| `POST /calls` | `CallRequest` (`{series_id, signer, session}`, the same session as a quote) → `Call`. A free call ([rules](#free-calls)) |
| `GET /calls/:account_id` | `Call[]` for that account, newest first, with `result: {price, points}` once scored |
| `GET /leaderboard` | `Leaderboard`: `round` (the latest scored round's date), `today` (its top 20) and `week` (the last 7 rounds' top 20), each `{account_id, rank, points, wins, streak}` |
| `GET /leaderboard/:account_id` | The same, plus `you: {today, week}` for that account (`null` when it didn't play) |
| `POST /faucet` | `{account_id}` → `{tx_hash}`. Only with `FAUCET=true`. CORS only for `APP_ORIGINS` (the requesting origin echoed back, never `*`), `content-type: application/json` required. Sends 100 `quote_asset` tokens (the contract's `quote_decimals`) into `account_id`'s intents balance: `ft_transfer_call` to `intents_id` with `msg` = `account_id`, 1 yocto, 100 TGas. Any NEAR account id, including lowercase `0x…` EVM accounts. Once per account and once per client IP (IPv6: per /48) per 24 h, kept in `DATA_DIR/faucet.json` before sending. Only a transfer the token refunded (`ft_transfer_call` returned `0`) frees the account and IP; any other failure (timeout, RPC error) counts as sent. 200 attempts per 24 h in total, refunded ones included |
| `POST /deposit-quote` | 1Click `/v0/quote` body → 1Click's quote (`{quote, …}`). CORS like `/faucet`. Only a deposit into an intents balance in `quote_asset`, exactly as `apps/web/src/api/oneClick.ts` sends it: `dry: false`, `EXACT_INPUT`, `ORIGIN_CHAIN`, a `nep141:` origin asset, a positive integer `amount`, slippage at most 100 bps, `recipient` = `refundTo`, both `INTENTS`, `deadline` in the next 24 h, no other fields (no `appFees`, `rebates`, `referral`). Forwarded with `ONECLICK_JWT`, 10 s timeout, 10 quotes per minute per client IP (IPv6: per /48), checked first, then 60 per minute across all clients. Answered only if 1Click's `signature` verifies ([Verify Quote Signatures](https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature)): Ed25519 by 1Click's key `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` (pinned in `oneClick.ts`, as in the 1Click SDK's `verifyQuoteSignature`) over the UTF-8 of base58(sha256(sorted-key JSON of the request fields + the quote's signed fields + `timestamp`)). The request fields we send come from our request, not 1Click's echo, so a quote signed for another recipient, asset or amount fails too. If 1Click rotates its key, deposit quotes answer `502` until the constant is updated. 1Click's `400` comes back as `400` with its message; its `429` as `503`; anything else (bad key, 5xx, no answer, a signature that doesn't verify) as `502` |

`POST /quote`, `/execute`, `/claims`, `/calls`, `/faucet` and `/deposit-quote` share one limit: 30 requests per minute per client IP (IPv6: per /64). `GET /fills` has its own: 600 per minute per client IP, so the app's polling never eats into trading. Each signer also gets 4 quotes per 25 s (one MM quote life), counted after the session check so nobody can spend another account's, and a quote that settles into a trade gives its slot back within that 25 s window, and a buyer needs $1 in `quote_asset` before any market maker is asked: the relay assumes no market maker sells for less (the MM's `MIN_PREMIUM_USD` default). Refused-for-funds quotes don't count against the limit. Set `TRUST_PROXY` behind a proxy, or every client shares one bucket.

`Quote.payload` is exactly what the wallet signs, `{standard, payload}`:
- `nep413`: `payload = {message, nonce, recipient}`. Sign with NEP-413 and publish `{standard, payload, public_key, signature}`.
- `erc191`: `payload` is the JSON string to sign. Publish it unchanged plus `signature` (`secp256k1:<base58 r‖s‖v>`, v = 0/1).

Errors: `400` bad input or a deposit quote 1Click refused, tampered or non-canonical payload, an amount below `min_write`, or options that pay nothing or under $1 in total; `401` session refused; `402` the balance doesn't cover the quote, or a buyer holds under $1 (deposit first); `403` faucet off; `415` faucet or deposit-quote body not `application/json`; `404` unknown or forgotten series/quote; `409` past the quoting stop (`quotableUntil`), a width no market maker lists at that strike, quote already published, price not final, payload already submitted or another from the signer still being sent, claims above the options held, above what the signer bought here or over 100 open per signer; `410` quote expired; `413` body over 64 KB; `422` refused by `simulate_intents`; `500` a send that errored and whose transactions failed, or none had succeeded or was still finalising once a final block passed its deadline; `429` rate limit (per IP, 10 deposit quotes per minute per IP, or 4 quotes per 25 s per signer) or faucet allowance used; `502` faucet transfer refunded or of unknown outcome, or 1Click failing (bad key, error, no answer, unverified quote); `503` no MM online, no valid quote, claim queue full, or deposit quotes over 60/min or 1Click rate-limiting us. Body: `{error}`.

## Free calls

Free calls move no money, but the caller needs at least $1 of `quote_asset` in their intents balance (read, never spent), so throwaway accounts cost something. Each call is priced at the relay's best ask for that series when it's made (never the request's; scores trust the market makers' marks), only on the next round (the UTC date of the nearest expiry still callable; on a sub-daily grid a round is the whole UTC day), and only until the 30-minute averaging window before its expiry opens (`TWAP_WINDOW_SEC`, `callableAt` in the SDK, even where the contract's cutoff is later). 10 per account and 100 per client IP (IPv6: per /48) per round, one per series, 10,000 waiting calls per round. All of these are checked before the balance. A call stakes 100 points and is scored once its price has been final for a minute: `min(payout per option × 100 ÷ ask, 2,500) − 100` (`callPoints` in the SDK, so at most 25×). A round's standings rank by points, then wins (calls above 0), then account id; the week sums the last 7 rounds; a streak counts consecutive UTC dates with a win up to the latest scored round (0 if that round wasn't a win, at most 60). Results are kept a day after their round and calls whose price never came a week. Refusals: `400` bad account, `401` session, `402` under $1 in the caller's balance, `404` unknown series, `409` closed, final round started, not the next round, already called, or an ask at or above the width, `429` 10 calls used this round, or 100 from that IP, `503` no price for that series right now or the round full.

## Collect (`/execute` and `/claims`)

Both take only an exercise, exactly as the SDK's `exerciseOptions` builds and `toSign` encodes it: one `transfer` to `options_id` with `msg` `{"action":"exercise"}`, `min_gas` 100 TGas, 1–10 long tokens of series in the `GET /series` listing, each at least the underlying's `min_write`. Redeem and burn_pair are MM-only, and the MM pays its own gas. Anything else is refused before any gas is spent. A relay process sends a `(signer_id, nonce)` on-chain once. If `/execute` errors, the relay polls the status of every transaction it signed for it at `final` like a [trade](https://docs.endline.trade/developers/relay-api): one that succeeded answers `200` with its `tx_hash`; all failed, or a final block more than 5 s past the deadline with none succeeded or still finalising, answers `500`. A claim whose send errors is resent only if the nonce is still unused. It sends one payload per signer at a time (a second gets `409` until the first lands or its outcome is known), so concurrent payloads over the same tokens don't each cost a failed transaction. Every payload it sends must still have 2 minutes left right after the relay's simulation: intents checks the deadline again on-chain, sending retries for up to ~85 s, and one that lapses first fails there on the relayer's gas. A claim with less left is dropped. The deadline must be written exactly as the SDK writes it (`toISOString`), so padding can't make the relayer pay for extra bytes.

- `/execute`: the payload must expire between 2 and 10 minutes from now (the app signs for 7); needs a final price (`now ≥ final_at + 60 s`) and a total payout of at least $1 (one quote-asset unit times `10^quote_decimals`), so splitting a win into tiny exercises can't burn the relayer's gas. Simulated, then executed.
- `/claims`: only for options the signer bought through this relay (net of sells, from `fills.jsonl`), one open claim per buy of that series, with a max payout of at least $1, so filling the queue costs one real trade per claim. A signer's open claims on a token can't add up to more than that or their intents balance of it; 100 open claims per signer, so one account can't fill the queue, 1,000 in total. Simulated, then stored in `DATA_DIR/claims.json`. Every minute the relay re-simulates every claim, drops the ones the verifier now refuses (tokens sold or already collected, deadline passed, nonce used), drops final ones that pay under $1 without sending them, and submits the rest once final (same rule).

## MM API (WebSocket `/mm`, header `Authorization: Bearer <api key>`)

| Direction | Message |
|---|---|
| Relay → MM | `{"method":"quote","params":QuoteEvent}`. `side` is the user's side. `deadline_ms` is when the auction closes; later answers are dropped |
| MM → relay | `{"method":"quote_response","params":{quote_id, premium, signed}}`. One answer per quote per connection |
| MM → relay | `{"method":"marks","params":[{series_id, ask, bid?, max_size, vol}]}`. Replaces that MM's previous marks ([Relay API](https://docs.endline.trade/developers/relay-api)) |
| Relay → MM | `{"method":"quote_status","params":StatusUpdate}` to the winner after a publish (`settled` with `tx_hash`, or `failed` with `reason`), or `expired` at `sign_by_ms` if the user never published, when the same signer asks for a new quote, or right after the auction if the user's balance no longer covers the quote |

Which answers count and who wins: [Relay API](https://docs.endline.trade/developers/relay-api#a-trade).
