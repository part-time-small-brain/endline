# Roadmap: demo to real product

Judges reward what is closest to a real product. Order = credibility per hour of work.

| # | Gap | Done when | Needs |
|---|---|---|---|
| 1 | App, landing, docs polished and bug-free | QA suite green, fresh review clean, deployed | — |
| 2 | Real wallets end to end | NEAR wallet + MetaMask: connect, session, buy, sell back, collect on the hosted app | 20 min of clicking from us |
| 3 | Fee model | Fee shows in the quote and lands in a treasury account | Pick the number (`.research/business/fees.md`) |
| 4 | Own domain | `<name>` + `docs.<name>` on a named Cloudflare tunnel | Buy domain, tunnel token |
| 5 | Mainnet, dust sizes | Contract on mainnet, OutLayer settles a real expiry, one real trade and collect | ~$50 of USDC + ~15 NEAR for the test; ~$6k of USDC stocks ~11 markets at $500 each, the app's default end date first (~$40k all 80) |
| 6 | Any-chain funding | Deposit from another chain via 1Click lands as USDC in the app. Quotes go through the relay with a 1Click partner key (no key = +0.25% on every deposit; with a key ~0.01% on USDC routes) | Mainnet (#5), 1Click Partner Portal key |
| 7 | Ops | Monitor + proposer alerts to a channel, uptime check, [runbook](runbook.md) | Webhook URL |
| 8 | Owner safety | Owner behind multisig, delay on oracle changes | Contract change + review |
| 9 | Submission | README "do X → see Y", demo video, X post, application form | Everything above that's done |

After the hackathon: open the RFQ to outside market makers, covered-call vaults (`ideas/covered-call-vault.md`), audit.

Scale, before mainnet volume:

| Gap | Why |
|---|---|
| Positions history older than 7 days: per-account index (fills or an indexer) | The relay serves series up to 7 days past expiry, so older positions vanish from the app (still claimable on-chain) |
