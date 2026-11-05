# A safer price override

`override_settlement` (`settlement.rs`) lets the owner replace an existing proposal's price with any positive price, at once, any time before `final_at`, and keeps `final_at`. Two problems follow ([known gaps](../security.md#known-gaps-accepted-for-the-hackathon-tracked)):

- **Captured owner key.** The thief buys cheap out-of-the-money options before the write cutoff, then overrides every pending proposal (one per `(underlying, expiry)` in its window) to `1` (puts pay their whole collateral) or a huge price (calls pay nearly all of theirs). An override one second before `final_at` is final with no time to react. `oracle_delay_sec` doesn't help: it only delays `add_oracle` and `set_oracle_wasm`.
- **Slow multisig.** Behind a multisig, fixing a bad oracle price (forged OutLayer result, bad manual `propose_settlement`) needs a vote inside the 1 h `dispute_window_sec`, which is fixed at deploy.

The [monitor](../security.md#monitoring) already flags any proposal, including an override, more than 50 bps from Deribit's delivery price or with no reference, and prints an `override_settlement` command signed as the owner. Nobody but the owner can act on that alert.

## Options

### (a) Veto-only guardian

A second, fast key can only void a pending price. Setting a price stays with the owner, and the owner's price can be vetoed too. This lets the owner be a slow multisig without losing the fast fix.

- `veto_settlement(underlying, expiry)`: guardian only, only before `final_at`, removes the settlement entry and emits `settlement_vetoed`. With no settlement, the normal paths work again: `request_settlement` until `E + oracle_window_sec`, then `propose_settlement`.
- No 1 yocto on `veto_settlement`, so the monitor can call it with a function-call key that allows only this method.
- `override_settlement` works with or without a proposal and sets `final_at = now + dispute_window_sec`, so the guardian and monitor get a full window to see it.
- `set_guardian(Option<AccountId>)`: owner, takes effect after `oracle_delay_sec` like `add_oracle`, and shown in `get_pending_oracle_changes`. Removing the guardian also waits, unlike `remove_oracle`: it removes a check, so it must not be instant.

| | |
|---|---|
| Stops | Racing a bad oracle price against a multisig vote: one guardian tx removes it. Re-proposals start a fresh 1 h window, so the guardian re-vetoes each one (the monitor does it automatically): a forged OutLayer result until `E + oracle_window_sec` (anyone can call `request_settlement`, and `set_oracle_wasm` waits a day), a bad manual one until the owner calls `remove_oracle`. Meanwhile the multisig sets the price without a deadline. Last-second overrides: every owner price gets a full window |
| Doesn't stop | A captured single-key owner, only delays it: it calls `remove_oracle` on every oracle (instant) and keeps re-overriding vetoed expiries until its new guardian is active a day later, then sets the price. Pending expiries can't escape in that day, so theft protection still comes from the owner being a multisig. A captured guardian stalling settlement until the owner replaces it (up to `oracle_delay_sec`); `burn_pair` still works. Owner + guardian colluding. Auto-veto trusts Deribit: if its delivery price is off, a correct manual price gets vetoed and the owner sets it. The owner can stall by re-overriding every hour, as it already can by removing every oracle |
| Contract | ~60–80 lines + tests. State: `guardian_id`, pending guardian with `active_at`. Changed: `override_settlement`, `get_config`, `get_pending_oracle_changes`. New: `veto_settlement`, `set_guardian`, event. New deployment (not upgradeable) |
| Dispute window | Unchanged (1 h) |
| Payout timing | Unchanged unless vetoed. After a veto: the new proposal's time + 1 h. Owner price: final 1 h after the owner's call |
| Ops | Guardian key on the monitor host, auto-vetoing. Owner is a slow multisig. The MM stops quoting while a guardian change is pending (not built). AGENTS.md rule 9 and the admin rows in security.md, contract.md and decisions.md change: the guardian can delay exercise and redeem, the owner by re-overriding |
| Monitor | Calls `veto_settlement` when a proposal is > 50 bps from Deribit; only alerts for an `owner_override` or when there's no reference (testnet minute expiries never have one). New alert for a vetoed expiry: today an empty settlement before `E + oracle_window_sec` is silent. The alert key needs `proposed_at`, or a new price under an open alert sends nothing. Alert on a pending guardian change |

### (b) Override bounded by data

The owner may only move the price within X bps of the proposal, or pick one of the oracle's own numbers (the 7 venue TWAPs or the Deribit value).

| | |
|---|---|
| Stops | Most theft: with X = 100 bps a captured key moves payouts by about 1% of notional at that expiry, instead of up to all of the collateral |
| Doesn't stop | The cases override exists for. A badly wrong price (BTC = 0, a forged OutLayer result) can't be fixed within X bps of itself, and a forged result forges its venue numbers too. Manual proposals carry no venue data, and `ok: false` stores nothing. NEAR has no independent on-chain second source ([oracle.md](../oracle.md#why-this-design)) |
| Contract | Bps check only: ~10 lines in `override_settlement`. Venue variant: parse and store `venues` and `deribit` from the fixing (`Fixing`, `accepted_price`, `Settlement`, ~100 bytes per expiry), ~40 lines |
| Dispute window / payouts | Unchanged |
| Ops / monitor | None new, but a bad proposal outside the bound needs another remedy, so it can't stand alone |

### (c) Delayed override with bonded challenge

An override starts its own longer window (e.g. 6–24 h, `final_at` moves out). During it anyone can challenge by posting a NEAR bond.

| | |
|---|---|
| Stops | Silent last-second overrides. Everyone sees the override for hours |
| Doesn't stop | Anything by itself. A challenge needs someone to rule on it: the owner (the captured key), a DAO vote (slow) or the guardian (that's (a)). Without a ruler a challenge can only void, which is (a) with a bonded, permissionless guardian. Users can't escape a pending bad price: after expiry nobody buys their options at a fair price |
| Contract | Largest: pending override state, bond deposit, refund or slash with callbacks, ~150+ lines |
| Payout timing | Every overridden expiry waits the full delay |
| Ops / monitor | Someone funds and files challenges; bond size to tune |

Right shape later if anyone may propose prices (UMA-style), overkill now.

### (d) Keep it, behind a multisig and a longer window

No code change. Owner is a 2-of-3 multisig (`propose_owner` / `accept_owner`), redeploy with `dispute_window_sec` of e.g. 6 h (max 1 day).

| | |
|---|---|
| Stops | Theft with one stolen key |
| Doesn't stop | Two signers colluding or compromised. Last-second overrides are still final at once. A bad oracle price still needs a vote, with more time |
| Contract | None. Window is an init argument, so a new deployment |
| Payout timing | Every expiry pays out a full window later (about E + 6 h instead of E + 1 h), even when the price is right. MM collateral at that expiry stays locked as long |
| Ops | Signers on call every day around 08:00 UTC + window. The monitor prints `sign-as <owner>`, which a multisig can't use: it needs to print a multisig proposal instead |

## Summary

| | Stops one-key theft | Fixes a bad price fast | Contract change | Slows normal payouts |
|---|---|---|---|---|
| (a) Guardian veto | With a multisig owner; a single key is only delayed 1 day | Yes (veto, then owner sets price) | Medium | No |
| (b) Bounded override | Mostly | No | Small | No |
| (c) Delayed + challenge | Only with a ruler | No | Large | Only overridden expiries |
| (d) Multisig + long window | Yes | Slowly | None | Yes |

## Recommendation

- **Hackathon:** no contract change. The mainnet deploy runs `contracts/options` from `HEAD` with about $50 at risk. Keep the 1 h window and follow [mainnet.md](../mainnet.md#owner-to-a-multisig). If the multisig signers can't act within the hour, a bad price costs dust; that is accepted and already listed in the known gaps.
- **Mainnet with real money:** (a) with a multisig owner and the 1 h window. The multisig is what stops theft; the veto takes the deadline out of fixing a bad price, so the multisig can be slow. Run the guardian as a function-call key in the monitor, auto-vetoing at > 50 bps from Deribit. Ship it in the next contract deployment; skip (b) and (c).
