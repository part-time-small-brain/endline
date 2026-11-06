# @endline/web

The consumer app: pick BTC/ETH, Up or Down, a date, a price to beat and a dollar amount, then buy with one signature (the first quote also asks for a [session](https://docs.endline.trade/developers/relay-api#a-trade) signature, valid 24 h and kept for the tab in `sessionStorage["session:<intentsId>:<standard>:<account>"]`). Trade defaults to Lite for every user; a header Lite/Pro/Tap toggle (kept in `localStorage`, Lite when unset) opens the existing chart ticket or the tap grid. The sun/moon toggle in the landing and app headers switches to the light theme (`localStorage["theme"] = "light"`, dark when unset; applied before first paint by the script in `index.html`). User guide: [Quickstart](https://docs.endline.trade/quickstart).

## Run

```bash
VITE_MOCK=1 pnpm --filter @endline/web dev
pnpm --filter @endline/web test
pnpm --filter @endline/web test:e2e
pnpm --filter @endline/web typecheck
pnpm --filter @endline/web build
```

Mock mode needs no backend: a demo wallet with $250, a mock relay on the real protocol types (its marks and quotes are Black-76 at a fixed vol per asset, ±1.5 vol points), and positions in every state (active, settling, proposed price, ready to collect, expired). NEAR and EVM wallets work too; signatures are real, settlement is fake.

`test:e2e` runs the Playwright suite in `e2e/` against its own dev servers (Chromium): the mock at 1440 and 390 wide; a testnet-like mock (`VITE_MOCK=1 VITE_NETWORK=testnet`: faucet, copy leaks); and a live testnet config (`deploy/testnet.json`) whose relay, RPC and Deribit answers the tests stub per route (landing with no relay, ticket with no or some marks). `Math.random` is seeded and the page clock starts at `E2E_NOW` (default `2026-11-04T12:00:00Z`), so the mock market is the same on every run. First run: `pnpm --filter @endline/web exec playwright install chromium`.

Against testnet with a running relay and MM: [Running locally](https://docs.endline.trade/developers/running-locally#full-stack-on-testnet). On testnet there is no 1Click: the deposit sheet's "Get 100 test USDC" calls the relay's `POST /faucet` (once a day per account and IP).

## Routes and look

| Path | Screen |
|---|---|
| `/` | Landing |
| `/app` | Trade |
| `/app/positions` | Positions |

With `VITE_APP_URL` set (hosted), one build serves two origins: on the app origin Trade is `/` and Positions `/positions`; on any other origin `/` is the landing and its links go to the app origin (`pathsFor` in `src/lib/route.ts`). Client-side routes; the server must answer unknown paths with `index.html` (Cloudflare Pages does when there is no `404.html`). `public/_headers` sets the security headers (a CSP whose fixed script nonce is the one `src/wallet/near.ts` gives near-connect's wallet iframes, which inherit the page's CSP, shared with the inline theme script in `index.html`) and immutable `/assets/*`; `public/_redirects` sends `/docs/*` to the docs site. Every page, the landing included, wears one dark look: the tokens on `:root` in `src/index.css` (near-black page, cream ink, NEAR green and coral, 6px corners) and an 18px dot grid on `body`, which the landing hero's cursor dots line up with. Fonts are Mona Sans and Geist Mono, bundled via `@fontsource-variable`.

Trading guide: [Quickstart](https://docs.endline.trade/quickstart). Lite (default): one sentence (end → asset → above/below → price to beat + % move → budget → win up to the capped gross payout), lists behind each slot, no chart; asset, direction and amount reuse the existing pickers (typed custom amount included). Dates with no mark are omitted; date-row chance is at the closest available price to beat. Always on the Lite ticket: gross payout multiple, estimated chance of ending above/below the price to beat, Max loss, "Full payout if BTC ends above/below $cap", Sell back now. Pro: the labeled ticket and chart, in the same NEAR panels and labels as Lite and Tap. Tap: a grid of every marked series for the asset (rows: prices to beat, high to low; columns: end dates, nearest first), each cell the Up series above spot or the Down series at or below it with its gross N×, a 24 h price line ending in a spot line across the grid, and a stake picker; a tap opens `QuoteSheet` for that cell at the stake, as in Lite and Pro (`lib/grid.ts`, `screens/Tap.tsx`). A held cell shows its value at the bid, its P&L % (only when it has a cost) and its N× underneath (`holding` in `app/usePositions.ts`), glows while spot is past its price to beat, and flashes once each time that flips; holding both sides of one cell, it shows the winning one. From 30 min before an end (`TWAP_WINDOW_SEC`, the oracle's averaging window, not the contract's cutoff) that column stays on the grid read-only (`lib/reveal.ts`), with only strikes the other columns or your stakes already show; after the end it stays while you hold a stake there, up to 3 h. In the final round your cells show the payout at the running average of Deribit's 1-minute index (closed minutes, the rest at spot) and a teal line marks it; after the end what it looks like they pay (no estimate under 25 minutes of data), then the proposed price, then the result; within 0.1% of the strike an estimate says too close to call. A final win that made money, sell-backs included (`bestWin` in `lib/shareCard.ts`), gets `ShareButton`: a 1200×630 PNG drawn in the NEAR look before the click, sent to `navigator.share` when it takes files, else downloaded; Positions offers it on won cards too. A Buy / Free call switch under the grid (`localStorage["tap-free"]`) turns taps into free calls on the next round (`hooks/useCalls.ts`, the relay's `/calls`, signed in with the wallet's session): cells show the call's multiple at the relay's ask, capped at 25× (`callMultiple` in the SDK), only the next round's quotable cells before its averaging window can be tapped (`callableAt`, `nextRound`, the relay's rule), called cells can't, called cells keep their place with a "Called" badge until their averaging window opens, Buy mode shows them at the buy multiple, the final round shows estimated points (`callPoints`), and `components/tap/FreeCalls.tsx` lists your calls with the round's and the week's leaderboard (`/leaderboard/:account`). The chart shows a one-time "Drag" hint on the price-to-beat line until the first drag (`localStorage.dragged`); the bars right of "End" are the payout at each end price, flat past the cap. Positions and `QuoteSheet` (firm quote, countdown, signatures) are shared. The landing hero is the Lite ticket itself (a skeleton until the listing loads); its "Try …" link opens Trade (`/app`, or the app origin's `/` with `VITE_APP_URL`) with `?series=<id>&pay=<dollars>` and the same trade, and while nothing is priced it is a plain "Open app" link. Only Trade keeps the ticket's buy bar pinned to the bottom of the screen. Amount chips are $10 / $25 / $50 / $100 / Other (whole cents, at least $1; the link's `pay` follows the same rule, else $25) with no Max chip: the relay only quotes what the balance covers, and a short balance turns the button into "Add funds to buy". Invalid custom amounts show a whole-cent, $1-minimum message and a disabled "Enter a valid amount" button. If Deribit has no price for an asset, Pro's chart says so and the asset switch keeps working.

## Env

Read by Vite from the shell or a `.env` file.

| Var | What |
|---|---|
| `VITE_MOCK` | `1` = in-browser mock, other vars ignored except `VITE_NETWORK=testnet` (testnet ids and a mock faucet instead of 1Click) |
| `VITE_RELAY_URL` | RFQ relay base URL (`apps/relay`). Optional: defaults to the page's own origin (relay paths proxied on the same host). On another origin, the relay's `APP_ORIGINS` must list the app's, or the faucet and deposits fail |
| `VITE_APP_URL` | Origin the app runs at, e.g. `https://app.endline.trade`. Optional: unset, the landing is `/` and the app `/app` on one origin |
| `VITE_NETWORK` | `mainnet` or `testnet` (wallets, explorer links; 1Click only on mainnet). Bundles the RPC, intents and options contract ids and quote asset from `deploy/<VITE_NETWORK>.json` at build time. No file (mainnet today): the app says it isn't configured |

## Where data comes from

| Data | Source |
|---|---|
| Series, quotable flag | relay `GET /series` |
| Firm quote, publish, status, fills | relay `POST /quote`, `POST /publish`, `GET /status/:id`, `GET /fills/:account` |
| Collect (exercise intent) | relay `POST /execute`, in batches of up to 10 positions, largest payouts first (`src/lib/collect.ts`). A batch under the relay's $1 minimum goes out as the user's own `execute_intents` from a NEAR wallet; EVM wallets are told it's too small |
| Auto-collect (exercise signed after a buy, sent once the price is final) | relay `POST /claims` |
| Test USDC (testnet) | relay `POST /faucet` |
| Free calls, points and leaderboard | relay `POST /calls`, `GET /calls/:account` (60 s), `GET /leaderboard/:account` or `GET /leaderboard` with no wallet (60 s, while the free-call panel is open) |
| Balances | `intents::mt_batch_balance_of` |
| NEAR wallet key setup (one time) | `intents::has_public_key`, `add_public_key` |
| NEAR wallet list | `src/wallet/manifest.json`: near-connect's manifest copied at a commit, every GitHub-hosted executor pinned to a commit, so the list and those scripts change only with a change here. Wallets that host their own script (Intear, NEAR Mobile, Trezu, EVM-on-NEAR) can still change it, near-connect serves a script it cached in the browser first, and its popup lets a user add a debug wallet. To update: copy a newer upstream manifest and pin its executor URLs the same way |
| Deposit from a NEAR wallet | `ft_transfer_call` of USDC to intents |
| Deposits from other chains (mainnet) | 1Click (`recipientType: INTENTS`, refunds to the intents account). Quotes go through the relay `POST /deposit-quote` (partner key) and are shown only if 1Click's Ed25519 signature verifies in the browser too (the SDK's `verifyDepositQuote`: pure-JS Ed25519 from `@noble/curves`, so it works in any wallet browser; every request field comes from what the app sent, never from 1Click's echo), so a compromised relay can't swap the deposit address. A quote is also refused if its signed USD out is more than 3% below its USD in (1Click doesn't sign `appFees`) or it carries a `depositMemo`; the sheet shows the signed amount that arrives. Tokens and status come straight from 1Click |
| Series status (active → close-only → awaiting price → proposed → final) | `src/lib/status.ts` from `expiry`, `get_config().timing.write_cutoff_sec` and `get_settlement` |
| Spot | Deribit index. An asset whose index fails is left out; the rest stay tradable |
| Ticket prices (Max loss, Sell back now, Pro Breakeven and If BTC ends above, Lite win up to and Full payout if) and position values | relay `GET /marks` every 5 s: size and cost at the ask, sell-back at the bid ([Relay API](https://docs.endline.trade/developers/relay-api)). A strike without a mark, or whose ask is as much as it can pay, is hidden, and so is a date with none left; listed series without a mark for the asset and direction, or any failed poll (or one taking over 5 s) until the next good one, show "No prices right now" |
| Chart cone | The vol of the listed strike nearest spot, from its mark |
| Chart history (last 24 h, a point per 5 min) and the final-round average estimate (every minute) | Deribit `get_index_chart_data` |
| Chance (Pro: Up / Down buttons; Lite: sentence, date rows at the closest marked price to beat, strike list) | Black-76 odds of ending past the price to beat, at the series' mark vol. Never odds of max payout or of profit |

Payouts, breakeven, sizing and the "If BTC ends above" best case (the cap and its payout) are bigint math on top of the SDK's `longPayout` (`src/lib/payoff.ts`, `src/lib/ticket.ts`). The pre-sign card is built from the exact `token_diff` the wallet signs, and the quote is rejected if the diff doesn't match it or it stays signable more than 120 s after it arrived (`src/lib/tradeCheck.ts`). The relay's series list is trusted only as far as the contract backs it: USDC and option decimals come from `get_config` and `get_underlyings`, and a series is shown only if its id is what the SDK's `seriesId` builds from its terms (`src/lib/listing.ts`), so a lying relay can't label one series as another.
