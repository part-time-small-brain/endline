# Endline

Pick where BTC ends. Fund from any chain, max loss is what you pay. Each position is a European, cash-settled option with a capped payout, fully backed in USDC, that lives and trades inside NEAR Intents. Live on NEAR testnet; mainnet (with deposits from any chain via 1Click) is built but not deployed yet.

## The problem

Crypto options trade on centralized venues or inside one chain's DeFi, and an options chain (strikes, greeks, margin) is unreadable for most people. Endline turns an option into "BTC Up $81,000 by tomorrow, pay $25", shows the most you can lose and win before you sign, and, with auto-collect on, pays a win of $1 or more into your balance without another signature.

## How NEAR fits

| Piece | What it does |
|---|---|
| NEAR Intents (`intents.near`) | Holds every balance: users' USDC, the collateral, and the option tokens. A buy or sell-back is one signed `token_diff` intent matched against the market maker; payouts are intents transfers. Nothing is bridged. Intents has no testnet, so testnet runs a copy of the exact mainnet wasm |
| NEP-245 option tokens | Each series (`BTC-27NOV26-81000_83000-C`: strike, cap, Up) is a multi-token minted by our options contract against USDC locked in full |
| RFQ relay + market maker | The app asks the relay for a quote, the house market maker answers with a firm price from Deribit's volatility, the user signs, the relay submits |
| Oracle WASM on OutLayer | The settlement price is the median of 7 exchanges' 30-minute averages, computed by our WASM, proposed on-chain and final after a dispute window. Mainnet runs it in an OutLayer TEE; testnet runs the same pinned WASM through our proposer as a manual oracle |
| 1Click | Deposits from other chains land as USDC in the user's intents balance (mainnet only, so not live yet) |
| Wallets | NEAR wallets through NEAR Connect sign NEP-413; Ethereum wallets sign ERC-191 with the 0x address as the account |

Tracks: `defi`.

## Try it (testnet)

Live app: https://app.endline.trade (landing: https://endline.trade, docs: https://docs.endline.trade).

1. Open the app. Lite starts with one editable sentence: end time, above or below, price to beat, amount and capped payout. Max loss and estimated chance stay visible. Lite / Pro / Tap in the header opens the chart ticket or the tap grid: rows of prices to beat, columns of end dates, tap a cell to buy it.
2. Click Connect and pick a wallet.
   - Ethereum wallet (e.g. MetaMask): nothing else to set up.
   - NEAR wallet: any from the testnet list (e.g. Meteor, Intear, Nightly, or NEAR CLI if you have `near` with a testnet account). A "One-time setup" card then asks you to click Enable: one transaction that lets the wallet sign trades on NEAR Intents, so the account needs a little testnet NEAR.

   The header shows your balance.
3. Click Add funds → "Get 100 test USDC". The balance goes up by $100 within seconds. Once per account and IP per 24 h.
4. Tap the sentence slots: Tomorrow, above, a price to beat and $25. Check the full-payout threshold and Max loss, then click "Buy Up · $25". The first time, your wallet asks for one signature that proves the wallet is yours for 24 h (no funds move). The confirm sheet then shows the firm price, the exact swap you'll sign and a countdown. Click "Buy for $X" and sign. You see "You're in" and can turn on auto-collect (one more signature).
5. Open Positions. The position shows Paid, Value now and P&L. Click "Sell back", then "Sell back for $X", and sign: the USDC lands in your balance.
6. Settlement: "Today" means the option ends on your current local calendar day; the list shows its end time (quoting stops 60 s before the end). About 10 minutes after the end the price is proposed (median of 7 exchanges) and it is final 2 minutes later. A win of $1 or more with auto-collect is paid into your balance 1 to 2 minutes after final; otherwise the position shows Collect.

Without a wallet: `pnpm install && VITE_MOCK=1 pnpm --filter @endline/web dev`, open http://localhost:5173/app, Connect → Demo wallet: the whole app against mock services with a $250 balance.

## Deployed

| | Testnet |
|---|---|
| Options contract | `opt5.near-options-dev.testnet` |
| Intents (copy of the mainnet wasm) | `intents.near-options-dev.testnet` |
| USDC (mock, 6 decimals) | `usdc.near-options-dev.testnet` |
| Oracle WASM | pinned by sha256 on the contract (`get_oracle_wasm`); the testnet proposer runs it as the manual oracle `oracle.near-options-dev.testnet` |

Mainnet: not deployed yet.

## Repo

| Path | What |
|---|---|
| `contracts/options` | Options contract (Rust, near-sdk): series, write, settle, exercise, redeem, NEP-245 |
| `oracle/` | Settlement price WASM run by OutLayer |
| `apps/web` | The app (React) |
| `apps/relay` | RFQ relay: quotes, trade settlement, gasless collect |
| `apps/mm` | Market maker, lister, settlement monitor, proposer |
| `packages/sdk` | Shared ids, payout math, intent payloads, signing |
| `tests/sandbox` | Integration tests against the real `intents.near` wasm |
| `apps/docs` | Public user and developer docs at [docs.endline.trade](https://docs.endline.trade) |

Built with near-sdk-rs, near-workspaces, NEAR Connect, near-api-js, viem, zod, React, Vite, Fumadocs, wasmtime and the NEAR Intents verifier and 1Click APIs.

```bash
cargo test -p options -p oracle && pnpm -r test
```

Contributors and agents: read [AGENTS.md](AGENTS.md) first. Full stack on testnet: [Running locally](https://docs.endline.trade/developers/running-locally#full-stack-on-testnet).

License: [MIT](LICENSE).
