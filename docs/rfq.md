# Trading: relay and market maker

How a trade works and the rules it follows. Endpoints and env: [relay README](../apps/relay/README.md). Quoting, pricing and hedging: [mm README](../apps/mm/README.md). Wire types: `packages/sdk/src/protocol.ts`.

## Why our own relay

The official NEAR Intents quote bus needs a partner JWT and KYC for market makers, and doesn't list NEP-245 assets. Our relay does the same job for option tokens. Users never need NEAR for gas: the relay pays.

## A trade, end to end

1. Web → relay `POST /quote {series_id, side, size, signer, session}`. `side` is the user's: `buy` or `sell` (to close). The relay checks the [session](#sessions-and-open-quotes) and that the signer's balance covers their open quotes.
2. Relay sends a `quote` event to every connected MM over WebSocket. The auction runs 300–1500 ms and closes early once every MM has answered.
3. Each MM answers with a premium and its signed `token_diff`. The relay keeps an answer only if:
   - the diff is exactly the expected MM leg for that premium and the verifier's fee;
   - its deadline is 20–60 s out and its nonce is versioned;
   - on a buy, the premium is below the most the size can pay (`floor(size·width/unit)`), whichever MM sent it;
   - `simulate_intents([mm])` leaves exactly the user's leg open (this also proves signature, key, salt, nonce and balance).
4. Best price wins (buy: lowest, sell: highest; ties: first answer). The relay re-checks the balance with the winning premium; if it falls short it refuses the quote and sends the winner `expired` at once. Otherwise it returns the unsigned user payload, which the user must sign before `sign_by_ms` (MM deadline − 3 s).
5. Web → relay `POST /publish {quote_id, signed}`. Accepted only if byte-for-byte what the relay issued and the quote is unused. The relay simulates both halves, then calls `execute_intents([mm, user])`: both fill or neither does. A failed simulation is `failed` at once. An error from `execute_intents` is not proof of anything (an RPC can error on a batch that ran), so the quote stays `settling` and the relay polls `is_nonce_used` for the user's nonce at `final`: used means `settled` (no tx hash), and only a final block more than 5 s past the payload deadline with the nonce still unused means `failed`, since the verifier checks the deadline against the block time. Nobody holds the `GarbageCollector` role on our verifier, so `cleanup_nonces` can't clear a used nonce first.
6. The fill is logged (`DATA_DIR/fills.jsonl`, the source of entry price and P&L) and the winning MM gets `quote_status`. An unpublished quote expires at `sign_by_ms` and the winning MM gets `expired`. Every MM frees its inventory only at its own leg's deadline, whatever the relay says, since the signed leg stays fillable until then.

## Marks

What the ticket shows before a quote: the MM's own price, so the firm quote matches it.

- After each market refresh (every 2 s) the MM sends `{"method":"marks","params":[{series_id, ask, bid?, vol}]}`: per series it would quote now, the ask and bid for one whole option (`terms.unit`) in quote units, before its $1 minimum, and its vol at the strike. `bid` is left out when the MM would pay nothing. The same function prices its quotes, so a buy's premium is `size × ask` (to within a quote unit per option), lifted to $1, and a sell's `size × bid`, refused under $1. Nothing while halted, past the quoting window (deadline after `expiry − write_cutoff_sec`), at a width it doesn't list, on stale Deribit data, when the ask doesn't convert to quote units or is at least the width, or above a vol of 10 (the schema's bound). Only series it holds long or short tokens of: a buy needs its long inventory and a sell-back exists only where it sold and kept the short. Ranked by what those tokens are worth at its own bid and ask (longs at the bid, shorts at width − ask) and cut off before the message would pass the relay's 64 KB frame limit, so pushing its marks out takes giving it tokens worth more than its own position in each series.
- The relay keeps each MM's latest list and drops it 10 s after receiving it or at once when that MM disconnects. `GET /marks` answers `[{series_id, ask, bid?, vol}]`: the lowest ask with that MM's vol, and the highest bid.
- The app polls it every 5 s. Ticket size and cost, "If BTC ends above", sell-back and position values come from ask and bid; the chance from the series' vol; the chart cone from the vol of the listed strike nearest spot. A series without a mark, or whose ask is at least its width, isn't offered, nor a date with none offered; when the asset and direction have listed series but no marks, or while the poll fails or takes over 5 s, the app says "No prices right now". Caps and inventory can still refuse the firm quote.

## Sessions and open quotes

Quotes cost nothing but reserve MM inventory until the MM's deadline (25 s), so the relay only quotes signers who prove their account and hold at least the $1 minimum premium, 4 times per 25 s each, where a quote that settles into a trade gives its slot back (within the same 25 s window), so someone trading quickly never waits while unpublished quotes still do. A settled quote still holds its MM reservation until its deadline, so quick trading counts twice against MM caps for about 30 s per trade.

- **Session.** The wallet signs once an intents payload with an empty intents list (`sessionPayload`, deadline 24 h in the web app). The relay accepts it only if it is canonically encoded, for `INTENTS_ID`, empty, from the request's `signer` and standard, with a deadline in the future and at most 7 days out, and `simulate_intents([session])` passes (signature, registered key, unused nonce). Verified sessions are cached until their deadline. Executing one on-chain only uses up its nonce.
- **One open quote per signer.** Issuing a new quote expires the signer's earlier unsigned ones (their MMs get `expired`). Until then the old quote stays signable, and holds count only quotes in auction or settling, so re-quoting never needs a second premium.
- **Balance-backed quotes.** A signer's quotes in auction or settling can't exceed their intents balance (`402` otherwise): buys count premiums in `QUOTE_ASSET`, sells count sizes per option token. Checked before the auction (a buyer needs $1, the smallest premium a market maker sells for) and again with the winning premium. Unsigned open quotes don't count: each new one replaces the last.

## Fees: why trade legs aren't mirror images

`intents.near` charges `ceil(amount × fee / 1,000,000)` on every amount someone gives up (live fee: 1). NEP-245 amounts ≤ 1 are free. Totals must balance exactly after fees, so payers send gross and receivers get net.

| Trade | User leg | MM leg |
|---|---|---|
| Buy `n` long for `p` USDC | `{U: -p, L: +n}` | `{U: +netOf(U, p), L: -grossFor(L, n)}` |
| Sell `n` long for `q` USDC | `{L: -n, U: +q}` | `{L: +netOf(L, n), U: -grossFor(U, q)}` |

Built by `buyDiffs` / `sellDiffs` in the SDK; `unmatched()` must be empty before submitting. Example: paying someone exactly 30,000,000 needs a gross of 30,000,031, not 30,000,030.

## Signing

| Wallet | Standard | Notes |
|---|---|---|
| NEAR | `nep413` | Named accounts register their key once (`add_public_key` on intents) |
| EVM | `erc191` | `signer_id` = lowercase `0x` address, no registration |
| Tap balance | `nep413` | `signer_id` = lowercase hex of the browser's ed25519 key (a NEAR implicit account), no registration; signed in the app with the SDK's `implicitSigner` ([ux.md](ux.md) F5) |

The SDK's `signing.ts` produces byte-identical payloads to `@defuse-protocol/intents-sdk` (tested). Passkey and Solana signing are out of scope.

## Collecting payouts

| Path | How |
|---|---|
| Auto-collect | After a buy the user can sign a second intent: send these longs back with `{"action":"exercise"}`, deadline expiry + 7 days. The relay stores it (`POST /claims`) and submits it once the price is final + 60 s; earlier would fail and burn the nonce. If the user sold meanwhile, simulation refuses it and the relay drops it |
| Collect button | The user signs the same intent after settlement; the relay submits it gaslessly (`POST /execute`) |

Both endpoints accept only an exercise of our own long tokens, so the relay never becomes a general-purpose gas payer. Redeem and burn_pair are MM-only and the MM pays its own gas. Each signed payload goes on-chain at most once, and both endpoints are rate limited per IP. Exact rules: [relay README](../apps/relay/README.md#collect-execute-and-claims).

## Moving between balances

`POST /transfer {signed}` moves USDC from one intents account to another without NEAR for gas, for example between a user's main balance and the app's Tap balance (a second intents account whose key the app derives). The signed payload is exactly the SDK's `relayedTransfer`: one plain `transfer` of `QUOTE_ASSET`, then a $0.01 `transfer` of it to the relayer, which more than covers the gas. An error from `execute_intents` here and on `POST /execute` settles by the signer's nonce as in step 5: used answers `200` with an empty `tx_hash`, unused past the deadline answers `500`, and the signer's next payload waits (`409`) until then. Exact rules: [relay README](../apps/relay/README.md#transfer-transfer).

## Market maker

Why it exists: [system.md](system.md#why-the-market-maker-exists). How it quotes, prices, reserves inventory and hedges: [mm README](../apps/mm/README.md).

- It writes inventory ahead of time: minting is async, so it can't happen inside a swap.
- It stops quoting at the write cutoff, on stale Deribit data, over a risk cap, out of inventory, or after two failed hedges. It stops sending [marks](#marks) on the same cutoff, stale data and halts.
