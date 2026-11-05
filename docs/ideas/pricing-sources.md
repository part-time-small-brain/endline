# Pricing sources

Which options venue the market maker prices from and what to do when it fails. The app now shows the MM's own price ([rfq.md](../rfq.md#marks), [decision](../decisions.md#2026-10-29)); this note keeps the fallback, which is still future.

Measured 2026-10-28/29: 52 snapshots of every venue (one at 10-28 12:57, then every 14 min from 14:24 to 10-29 02:07 UTC, around the 18:00 FOMC decision) from our server (India); OI, volume, spreads, refresh rates and the event-day numbers from 6 earlier snapshots (10-28 12:51–13:27 UTC, before the decision); reachability also from a US datacenter (AWS), and 30 days of Deribit trades (each carries the mark price and index at trade time) for 1-day and 4-hour options, priced with the MM's own code. Scripts and raw numbers: `.research/pricing-sources.md` (local).

## Today

The MM reads Deribit `get_book_summary_by_currency` every 2 s: mark IV per strike, interpolated in log-moneyness on the nearest expiry. It stops quoting, and publishing marks, when its data is older than 10 s.

## Venues (BTC)

| | Deribit | OKX | Bybit | Binance | Gate | Delta |
|---|---|---|---|---|---|---|
| Options OI | $32 B | $2.8 B | $1.7 B | $1.2 B | $53 M | $0.35 M |
| 24 h volume, next-day expiry | 3.2k BTC | 1.6k | 3.3k | 2.8k | 0 | 2 |
| Daily 08:00 UTC expiries (we list 4) | 4 | 4 | 3 | 3 | 4 | 0 (12:00 UTC) |
| Next-day OTM spread, median | 2.7 vol pts (0.0005 BTC ticks) | 1.5 | 0.5 | 0.5 | 6.3 | 2.6 |
| Our grid priced from its smile vs Deribit, next-day, median (p90) | – | 2.7 % (20 %) | 0.9 % (5.0 %) | 0.5 % (4.6 %) | copies Deribit's marks | wrong expiry time |
| Mark IV vs Deribit, OTM ±5 %, ≤ 36 h, abs pts median (p90) | – | 1.5 (5.5) | 0.6 (3.4) | 0.25 (0.8) | 0.1 (1.0) | – |
| ATM mark IV changes per 90 s | ~20 | ~75 | ~10 | 2–7 | ~30 | – |
| From a US datacenter | ok | ok | 403 | 451 | ok | ok |
| Browser CORS | yes | yes | yes | no | broken (`*, *`) | yes |
| Quote currency | BTC | BTC or USD | USDT | USDT | USDT | USDT |

- All free without a key. Published limits (Deribit ~20 req/s, OKX 20 per 2 s, Bybit 600 per 5 s, Binance 400 weight/min) cover the MM's 2 calls per underlying every 2 s; Binance's `mark` + `index` (weight 6) every 2 s uses 180 of its 400.
- USDT venues index ~15 bps above the USD index, so a USDT forward and strikes need rescaling.
- No venue lists vanilla options shorter than daily. Testnet 4 h expiries borrow the next daily smile; how far off that is wasn't measured.
- ETH: Deribit holds ~62 % of OI; next-day agreement Binance 0.8 %, Bybit 1.7 %, OKX 2.1 %.
- Derive: old API 503, v3 not tested.

## Recommendation

1. **Primary: stay on Deribit.** ~85 % of BTC options OI, the same four 08:00 dailies as our grid, its delivery prices already back the oracle veto and the monitor, reachable from the US and from browsers.
2. **Fallback: Binance, after the hackathon.**
   - Over 12 h its marks sat closest to Deribit's of the independent venues (0.25 vol points median, p90 0.8; Bybit 0.6 / 3.4). Its mark IV moves only a few times a minute, it takes `mark` and `index` each poll plus a cached `exchangeInfo`, and it publishes no forward (index × e^(rT) from `mark`'s `riskFreeInterest`); Bybit is the second choice. OKX's next-day marks are off; Gate copies Deribit, so it fails with it.
   - From a US server there is no good next-day fallback: the MM stops quoting.
   - For the hackathon the MM stops quoting while Deribit fails, as now.

## Plan

| Change | Where | Test that fails first |
|---|---|---|
| Binance fallback | `apps/mm`: `binance.ts` next to `deribit.ts` | Deribit failing → Binance marks used. Needs a USD reference without Deribit (or USDT ≈ USD, ~15 bps off) and a forward from index × e^(rT); covers 3 of our 4 dailies |
