# Endline docs

Cross-chain BTC/ETH options settled through NEAR Intents. Fund from any chain, buy a call or put with one signature, get paid automatically at expiry.

## Current scope (changes as we build)

| In | Out (see [ideas/](ideas/)) |
|---|---|
| European, cash-settled BTC and ETH calls and puts with a capped payout, fully collateralized in USDC (sandbox-tested against the real intents wasm, live on testnet as `opt3`) | Margin, liquidations, American options, uncapped payouts |
| Buy and sell-to-close via RFQ against our market maker | Order book, multiple external MMs |
| Settlement on the median of 7 major exchanges via OutLayer, dispute window, manual fallback | Other oracles |
| Auto-collect at expiry (claim signed at buy time) and a manual Collect button | Push payouts |
| Web app: Up/Down, positions, collect, deposit from any chain | Covered-call vault, agents, confidential mode, stock options |
| Testnet demo with minute expiries; mainnet deploy with dust sizes | Anything needing paid APIs |

Change this table when scope changes, so humans and agents work from the same list. Only list something as in once it works.

## Docs

| Doc | Read it for |
|---|---|
| [system.md](system.md) | Start here: every service, why it exists, how they talk, environments, running the stack on testnet |
| [contract.md](contract.md) | The options contract: methods, messages, math, ids |
| [oracle.md](oracle.md) | How the settlement price is fixed |
| [rfq.md](rfq.md) | How a trade works: auction, fee-exact legs, signing, collecting |
| [security.md](security.md) | Threats and the rules every change keeps |
| [ux.md](ux.md) | Product principles, flows, copy |
| [roadmap.md](roadmap.md) | Gaps between the demo and a real product, in order |
| [runbook.md](runbook.md) | Operating the hosted stack: status, restarts, deploys, what each alert means and its fix |
| [mainnet.md](mainnet.md) | Deploying to mainnet with dust sizes, step by step |
| [decisions.md](decisions.md) | Why things are the way they are |
| [resources.md](resources.md) | External links, APIs, accounts and secrets |
| [relay](../apps/relay/README.md), [mm](../apps/mm/README.md), [web](../apps/web/README.md), [sdk](../packages/sdk/README.md) | Per-package run commands, env, endpoints |

## Glossary

| Term | Meaning |
|---|---|
| Series | One option: underlying, strike, width, expiry, call or put. Id like `BTC-27NOV26-110000_112000-C` (strike, then cap) |
| Width / cap | The most a contract can pay, and the price where that is reached: strike + width (call) or strike − width (put) |
| Long | The option. Pays `min(max(S-K, 0), width)` (call) or `min(max(K-S, 0), width)` (put) in USDC at expiry. Token id = series id |
| Short | The writer's claim on leftover collateral. Token id = series id + `-SHORT` |
| Write | Lock `width` in USDC per contract, receive equal long + short |
| Burn pair | Return long + short, get the collateral back. Any time |
| Write cutoff | `timing.write_cutoff_sec` before expiry: writes and quotes stop, positions are close-only |
| Final price | The settlement price once its dispute window (`final_at`) has passed |
| Exercise / redeem | Turn long / short into its payout once the price is final |
| Collect | User-facing exercise, submitted gaslessly by the relay. Auto-collect = an exercise pre-signed at buy time (a "claim") |
| Intents asset id | `nep141:<token>` or `nep245:<contract>:<token_id>` |
