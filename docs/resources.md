# Resources

Everything external this project depends on, plus where our own source material lives. Check the live docs before relying on an API: they change.

## Hackathon

| What | Link |
|---|---|
| NEAR HACKATHON (dates, tracks, submission) | https://nearhackathon.com |
| Agent instructions + submission API (re-read before submitting) | https://nearhackathon.com/HACKATHON.md |
| NEAR Discord (questions, OutLayer/Intents teams) | https://discord.gg/RhZGHPXPf2 |

Key dates: dev Nov 1–14 2026 (repo public by Nov 14 23:59 UTC), judging Nov 16–18. One submission per team. Tracks we fit: `defi`, `agents`, `open`.

## NEAR and Intents

| What | Link |
|---|---|
| NEAR docs | https://docs.near.org |
| NEAR Intents docs (verifier, 1Click, message bus, confidential) | https://docs.near-intents.org |
| Verifier source (`intents.near`), deployed v0.4.5 rev `16d04f6` | https://github.com/near/intents |
| 1Click token list (asset ids, decimals) | https://1click.chaindefuser.com/v0/tokens |
| intents-sdk (TS signers, payload formats) | https://github.com/defuse-protocol/sdk-monorepo |
| Example solver we based the MM pattern on | https://github.com/defuse-protocol/near-intents-amm-solver |
| near-sdk-rs 5.29 | https://docs.rs/near-sdk/5.29.1 |
| near-workspaces (sandbox tests) | https://github.com/near/near-workspaces-rs |
| near-cli-rs | https://github.com/near/near-cli-rs |
| NEP-245 multi-token standard | https://github.com/near/NEPs/blob/master/neps/nep-0245.md |

## OutLayer (settlement oracle runtime)

| What | Link |
|---|---|
| Docs (getting started, NEAR integration, WASI, pricing) | https://outlayer.fastnear.com/docs/getting-started |
| Contract + worker source | https://github.com/out-layer/outlayer |
| CLI (`cargo install --git`) | https://github.com/out-layer/outlayer-cli |
| Oracle example we copied patterns from | https://github.com/out-layer/oracle-example |
| Testnet API (jobs, workers, stats) | https://testnet-api.outlayer.ai/public/jobs |

Contracts: `outlayer.near`, `outlayer.testnet`.

## Price sources (all free, no key)

| Source | Endpoint used |
|---|---|
| Deribit delivery price (oracle veto and monitor reference, 08:00 UTC expiries) | `public/get_delivery_prices` |
| Deribit index history (monitor reference for non-08:00 expiries) | `public/get_index_chart_data` (`range=1d`, 1-minute points) |
| Deribit options data (MM pricing) | `public/get_book_summary_by_currency`, `public/get_index_price` |
| Deribit index (web spot and chart) | `public/get_index_price` (`btc_usd`), `public/get_index_chart_data` (`range=1d`) |
| Coinbase, Kraken, Bitstamp, Bitfinex (USD) | 1-minute candles, see `oracle/src/sources.rs` |
| Binance (`data-api.binance.vision`), OKX, Bybit (USDT) | 1-minute candles, converted via the USDT/USD TWAP |

API docs: https://docs.deribit.com. Each venue's public market-data docs are linked from its site.

## Hedging and hosting

| What | Link |
|---|---|
| Hyperliquid API docs | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api |
| `@nktkas/hyperliquid` (TS SDK) | https://github.com/nktkas/hyperliquid |
| Pinata (IPFS hosting for the oracle WASM, free tier) | https://docs.pinata.cloud |

## Our own sources

| What | Where |
|---|---|
| Research with citations (prior art, intents internals, oracle, RFQ/MM, UX) | `.research/` |
| Deployed testnet account ids | `deploy/testnet.json` |
| Cross-language test vectors | `testdata/vectors.json` |
| Recorded API responses for oracle tests | `oracle/tests/fixtures/` |
| Deribit fixtures for pricing tests | `packages/sdk/src/fixtures/`, `apps/mm/src/fixtures/` |

## Accounts and secrets (never in the repo)

| What | Where it lives |
|---|---|
| Testnet keys (`near-options-dev`, `near-options-funder-1/2`) | `~/.near-credentials/testnet/` on the machine that created them |
| OutLayer CLI login | `~/.outlayer/testnet/` (via `outlayer login testnet`) |
| Pinata JWT | `PINATA_JWT`, or macOS Keychain: `security add-generic-password -a near-options -s pinata-jwt -w` |
| Relay and MM keys, MM API keys | Process env of whoever runs them ([system.md](system.md#testnet-from-scratch)) |

Each person uses their own testnet accounts, Pinata key and OutLayer login. Setup: [system.md](system.md#testnet-from-scratch).
