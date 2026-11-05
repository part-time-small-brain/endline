# SDK

Shared TypeScript for relay, MM and web. Source only, no build step: import `@endline/sdk`.

| File | What |
|---|---|
| `series.ts` | Series ids (`BTC-27NOV26-110000_112000-C`), long/short token ids, intents asset ids |
| `math.ts` | Capped long payout at settlement, in USDC units, same rounding as the contract |
| `fees.ts` | Intents fee, exact gross-up, `unmatched()` check of a set of diffs |
| `trade.ts` | `buyDiffs` / `sellDiffs`: fee-exact user and MM legs of a trade |
| `intents.ts` | Intent payloads: `token_diff`, write and close transfers, versioned nonce |
| `signing.ts` | What NEP-413 and ERC-191 wallets sign, and reading it back |
| `protocol.ts` | Wire and contract-view schemas (zod) |
| `black76.ts` | Black-76 price, delta, vega |

Series ids and payout math are tested against `testdata/vectors.json`, shared with the Rust contract. Signing is tested byte for byte against `@defuse-protocol/intents-sdk`. Trade flow: [docs/rfq.md](../../docs/rfq.md).

```bash
pnpm --filter @endline/sdk test
pnpm --filter @endline/sdk typecheck
```
