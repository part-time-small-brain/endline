# AGENTS.md

Rules for every human and AI agent working in this repo. Short on purpose. Read it fully before touching code.

## What this is

Endline: cross-chain crypto options settled through NEAR Intents. European, cash-settled BTC/ETH calls and puts with a capped payout, fully collateralized in USDC. Option series are NEP-245 tokens that trade inside `intents.near` via `token_diff`. Start with `apps/docs/content/docs/index.mdx`, then `apps/docs/content/docs/developers/architecture.mdx`.

## Layout

| Path | What | Lang |
|---|---|---|
| `contracts/options` | Options contract: series, write, settle, exercise, redeem, NEP-245 | Rust, near-sdk |
| `packages/sdk` | Series ids, payout math, fee-exact trade legs, intent payloads, signing, wire schemas | TypeScript |
| `oracle/` | Settlement price fetcher run by OutLayer in a TEE | Rust, wasm32-wasip2 |
| `tests/sandbox` | Integration tests against the real mainnet `intents.near` wasm | Rust, near-workspaces |
| `scripts/` | Dev scripts: sandbox wasms, testnet deploy, oracle smoke test, mainnet deploy plan (prints, never signs) | bash |
| `deploy/` | Deployed account ids per network (no secrets), Docker images and compose for hosting | JSON, Docker |
| `apps/relay` | RFQ relay: auction, trade settlement, gasless collect | TypeScript, Node |
| `apps/mm` | Market maker bot plus `write` / `positions` / `monitor` / `propose` / `settle` CLIs | TypeScript, Node |
| `apps/web` | Consumer app | TypeScript, React, Vite |
| `apps/docs` | Public user and developer docs at `docs.endline.trade` ([maintaining](apps/docs/content/docs/developers/running-locally.mdx#these-docs)) | MDX, Fumadocs, Next.js static export |
| `testdata/` | Cross-language test vectors. Rust and TS both test against them | JSON |
| `.docs/` | Private planning, decisions and operating notes. Local only, gitignored | Markdown |
| `.research/` | Raw research notes with sources. Input, not truth. Local only, gitignored | Markdown |

## Commands

```bash
cargo test -p options -p oracle
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
pnpm install && pnpm -r test && pnpm -r typecheck
pnpm --filter @endline/web build
pnpm --filter @endline/web test:e2e
pnpm --filter @endline/docs build

(cd contracts/options && cargo near build non-reproducible-wasm)
cargo build -p oracle --target wasm32-wasip2 --release

scripts/fetch-sandbox-wasms.sh
cargo test -p sandbox-tests

scripts/oracle-smoke.sh <your-account>.testnet
scripts/deploy-testnet.sh <your-account>.testnet
```

`cargo build` on the contract fails by design (near-sdk guard). Sandbox tests need the contract wasm built first and the fetched wasms in `tests/sandbox/res/`.

Testnet scripts sign with the near CLI legacy keychain (`~/.near-credentials`). `oracle-smoke.sh` also needs a Pinata JWT: [Oracle WASM](apps/docs/content/docs/developers/oracle.mdx#pinning-a-new-wasm). Running relay + MM + web: [Running locally](apps/docs/content/docs/developers/running-locally.mdx#full-stack-on-testnet).

Toolchain: Rust 1.95 with `wasm32-unknown-unknown` and `wasm32-wasip2`, `cargo-near` 0.22, `near` (near-cli-rs), `outlayer` (outlayer-cli), `wasmtime`, Node 24, pnpm.

## Code rules

- Simplest code that works. If a reviewer needs a minute to follow it, rewrite it.
- No comments. Only exception: one short line where another agent or reviewer would otherwise make a mistake (a unit, a non-obvious invariant, an external quirk). If code needs explaining, rename or restructure it instead. Delete every comment you added before showing a diff.
- Small files with one job. Match the neighbouring file's structure and naming.
- Reuse before adding. No new dependency, abstraction, util or file without a concrete second use.
- No speculative features, flags or config. Build only agreed scope; public docs describe current behaviour.
- Read the code and the docs before changing behaviour. Never assume an API exists: check docs.rs, the NEAR docs or the source.
- Every behaviour change ships with a test that fails before and passes after.
- Tests exist to break things: wrong caller, wrong asset, bad msg, replays, rounding edges, failed callbacks, time boundaries, invariants under random input. Don't write tests that only confirm the obvious happy path or a getter.
- Leave no dead code, `todo!()`, commented-out code, debug logs or unused exports.

## Contract rules (non-negotiable)

1. Collateral and options live inside `intents.near`. Users reach us only through a signed intents `transfer` with `msg`, which calls our `mt_on_transfer`. We pay out with `intents.near::mt_transfer`. No `ft_on_transfer`, no withdraw-with-msg paths.
2. `mt_on_transfer` accepts calls only from `intents.near`. Amounts and `sender_id` come from intents, never from `msg`. A panic there is safe: intents refunds the signer.
3. `mt_on_transfer` always returns a plain value, never a promise. Follow-up calls (delivering options, payouts) are detached and have their own callback.
4. Payouts never exceed collateral. Holder payouts round down, protocol keeps the dust. `collateral_locked` is checked before every payout.
5. Settlement uses only the oracle's price for that exact `(underlying, expiry)`, final after the dispute window. Never a spot price, never a pool price, never "latest".
6. Series ids come from their parameters (`BTC-27NOV26-110000_112000-C`). Mainnet expiry is 08:00 UTC; testnet follows its configured minute grid.
7. Every cross-contract call has a callback that handles failure explicitly. Don't change state after scheduling a promise in a way the callback can't undo.
8. Math uses u128 with U256 intermediates. Overflow panics, it never wraps. Release builds keep `overflow-checks = true`.
9. Admin can pause writes and override a settlement inside the dispute window. Admin can never move user collateral or block exits.
10. A change to math or series ids means updating `testdata/vectors.json`. Rust checks every field; TS mirrors only what the apps use (series ids, `longPayout`). Keep both green.

## Review cycle (every change, no exceptions)

Tests prove behaviour. They don't prove the code should exist. After writing, read every line of the diff and ask:
- Does this line need to exist? If removing it breaks nothing that matters, remove it.
- Is there a simpler way: fewer branches, fewer types, fewer files, reuse instead of a new helper?
- Does every test try to break something real? Delete tests that only restate the code.
- Would a new teammate understand it in one read? If not, rename or restructure.

Then get a fresh-context review of the whole package with the same questions. Fix everything it finds before moving on.

## Docs rules

- Same bar as code: short, decisive, for a purpose. Tables and bullets over prose. No filler, no repeating other docs; link instead.
- `apps/docs/content/docs/` describes current behaviour. Change code and its public doc in the same change.
- Plans, ideas, decisions and operating notes stay in ignored `.docs/`. Research stays in ignored `.research/`.
- Never publish private notes through tracked files, generated docs or build contexts.

## Safety

- Never push to `main`, and never force-push. Work on a branch in its own worktree (`.worktrees/<name>`), commit with Conventional Commits, and open a PR to `main` (`--assignee @me`). Merge only after a fresh-context review, and only when nero merges or says an agent may.
- Never create remotes or make the repo public. A human does that.
- Never sign transactions, deploy to mainnet or spend tokens. Testnet deploys only when a human asks.
- No secrets in the repo. Keys come from env vars. Never read `.env*` files.
- No employer or internal data in this repo.

## Before you say "done"

- Run the commands above for every package you touched. Say what you ran and what you didn't.
- Re-read your own diff as a hostile reviewer: bugs, edge cases, rounding, failure paths, anything not needed.
- Keep the diff minimal. Don't reformat, rename or "improve" code you weren't asked to touch.
