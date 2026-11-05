# UX

Product rules for `apps/web`. They also shape the contract, SDK and relay.

## Principles

1. **Up / Down, not call / put.** "Call" and "Put" exist only as screen-reader labels. Pro ticket order: asset → direction → date → price to beat → dollar amount. Lite sentence order: end date/time → asset → above/below → price to beat + % move → budget → win up to the capped gross payout. Tap order: asset → stake → tap a cell (row: price to beat, column: end date).
2. **One balance per place.** The header shows one dollar figure: the USDC balance inside `intents.near`. Buys spend it and every payout lands in it. The Tap screen also shows the Tap balance (F5), labeled as such and never added to the header's. Tapping it on mobile opens the deposit sheet. Chains appear only in the deposit sheet.
3. **Dollars in, dollars out.** Users pick "You pay $25" and contract sizes follow from it. Every payout is USDC ("Collected $40.00"). Whole dollars from $100, cents below.
4. **Max loss is always visible.** It is the price paid, shown as "Max loss $25" on the ticket and as the price on the confirm sheet. Retail only buys and sells back. Writing, short tokens, burn pair and redeem are MM-only and never shown to retail.
5. **No manual exercise.** Payout is automatic through a pre-signed claim (see [rfq.md](rfq.md)). Anyone without one sees a "$X ready to collect" banner on every app screen. A $0 outcome never asks the user to do anything. A tap from the Tap balance signs its claim at once, in the browser.
6. **Show the spread before buying.** The ticket shows "Sell back now $Y", the MM bid for the same size.
7. **Never auto-accept a worse price.** Tap: a tap signs only while the firm quote still pays at least the N× on the cell (rounded down to tenths, as shown) and costs at most the stake + 5%, the max loss shown; otherwise "The price moved. Tap again for the new one." and nothing is signed.
8. **Local time first.** Every time shows in the user's time zone. UTC is a faded secondary: in the Lite date list, on hover next to the Pro countdown and over Tap's column headers, inline on positions and the confirm card. Countdowns need no zone.
9. **One home per fact per screen.** Each number appears once on a given screen, where the user acts on it. Lite and Pro may each show Max loss, chance and sell-back. Exception: budget is in the amount control and again on the Buy button ("Buy Up · $25"). Pro: labels, not sentences; the chart's hover (tap on touch) shows the payout at any end price; the ticket shows it for one winning scenario only (rule 13). Lite: one sentence plus the supporting facts below; no chart. Tap: each cell shows only its gross N×; Max loss per tap sits under the stake; chance, breakeven and sell-back wait for the confirm sheet and the position.
10. **Written as the real product.** The network shows once: a tag in the app header ("Testnet", or "Demo" in mock mode). No testnet, demo or "planned" wording anywhere else in the app or on the landing; the only exception is the "Get 100 test USDC" button in the deposit sheet, shown on testnet only. Mainnet-only features (any-chain funding) are described as features; the deposit sheet shows what the current network supports.
11. **Risk info in one place per surface.** Landing: one line in the footer linking to the docs' Safety and risks. Docs: a status note on the intro and the full list on Safety and risks. The app: Max loss on the ticket and the confirm sheet's one risk line (see Copy).
12. **No raw ids.** Users never see series or token ids. A series is its title, its cap and its end time ("BTC Up $81,000", "Capped at $83,000", "Ends Tue 27 Oct, 1:30 PM"). Position cards and the pre-sign card show all three.
13. **Show the upside next to the loss.** Both views show the honest cap scenario. X is the cap, the price to beat plus (Up) or minus (Down) the width. Y is the most the bet can pay — gross, not profit. Pro shows it only when it beats what you paid: label "If BTC ends above $X" (Down: "below"), value "$Y · N×"; N is Y ÷ what you paid, rounded down to one decimal. Lite: "win up to $Y" is the exact capped payout, even when rounding leaves no profit; the N× payout chip uses the same gross ratio, never profit or a guarantee; the cap stays on screen as "Full payout if BTC ends above/below $X". Tap: each cell shows the same gross N× as Lite's chip, rounded down to one decimal, even when it doesn't beat the cost. Chance is the estimated odds of ending above/below the price to beat, not of hitting the cap, max payout or profit.

Reference product: Hypercall (RFQ by default, dollar presets, a breakeven column, basic view by default).

## Lite, Pro and Tap

Lite is the default for every user. A Lite / Pro / Tap control in the app header switches the Trade screen. The choice lives in `localStorage` (Lite when unset) and syncs across tabs. Escape closes a Lite picker without changing its selected value and returns focus to its slot. Scrolling its slot out of view also closes the picker. Below 640 px the header is two rows on every screen: the mark, then the network tag, balance and account (or Connect) on the right; below them the Trade / Positions tabs, with the Lite / Pro / Tap control filling the rest of that row on Trade.

Every app screen (Lite, Pro, Tap and Positions) wears the NEAR look in both themes; only the landing page keeps Horizon: a near-black dot grid, NEAR green Up (`#00ec97`), coral Down (`#ff7966`), bone text, Mona Sans with Geist Mono uppercase labels, 6 px corners (14 px on sheets), hairline panels with corner brackets in the side's colour, Lite's sentence slots outlined with a mono label on their edge (a word of the slot's accessible name), and a teal dot for anything live. It is a token set (`[data-look="near"]` in `apps/web/src/index.css`) on `<html>` on every route but `/`, set before first paint, so the header, banners and confirm sheet look the same in every mode; a `near:` variant changes shared components' shape and type only there, which keeps the landing's widgets on Horizon. Panels are hairline (`border-rule`, 6 px) with corner brackets on the main panel of a screen (Lite's ticket, Pro's order, Tap's grid); labels are Geist Mono uppercase; the collect banner takes the width of the screen's content. The NEAR look overrides `--font-sans`/`--font-display` rather than setting fonts on elements, so a utility like `font-mono` still wins. There is no theme switch in the app; the landing keeps it.

| | Lite | Pro | Tap |
|---|---|---|---|
| Trade | Sentence ticket, lists behind each slot, no chart | Existing chart + labeled ticket, unchanged | Grid of listed series with a 24 h price line running into a spot line across it; tap a cell to buy it |
| Positions | Same screen | Same screen | Same screen |
| Buy / sell-back confirm | Same `QuoteSheet`: firm quote, countdown, signatures, auto-collect | Same | Same |

## MVP flows

| # | Flow | Notes |
|---|---|---|
| F1 | Sign in + fund | NEAR wallet (NEAR Connect) or EVM wallet (MetaMask). Deposit sheet backed by 1Click (`recipientType: INTENTS`, destination native USDC); on testnet a "Get 100 test USDC" button (relay faucet) instead. Fund first, then quote: deposits take longer than a quote lives, and the relay quotes only what the balance covers |
| F2-lite | Buy Up/Down (default) | One sentence, slots in order: end date/time → asset → above/below → price to beat + % move → budget → win up to $Y (capped gross payout). Tap a slot for its list. Dates: up to four with a mark, matching Pro; each row shows chance at the closest available price to beat. Price list: high to low with a "Now $X" line at the current price; each row shows price, % move and chance as ten segments and a percent. Cap stays below the sentence. Asset and above/below are lists like the date and price lists (asset: price; above/below: chance); amount reuses the existing picker and opens above its slot so the payout stays visible, typed custom included. Lists float on a raised panel over the ticket. Always on the ticket: payout multiple, estimated chance of ending above/below the price to beat, Max loss, "Full payout if BTC ends above/below $cap", Sell back now. No chart. Then "Buy Up · $25" (budget repeated) over "Settles on NEAR Intents"; Max loss, Sell back now and the button stay pinned to the bottom of screens at least 44rem tall, which keep focus clear of them; shorter screens leave them after the ticket so the payout shows first. A quote refused for balance offers "Add funds to buy" |
| F2-pro | Buy Up/Down (chart) | Existing ticket, unchanged. Top to bottom: Up / Down with chance → date chips (day only; testnet minute expiries add the local time) → price to beat stepper with the % move faded, or drag the line on the chart → Safer / Balanced / Bolder → $10 / $25 / $50 / $100 / Other → Max loss beside "If BTC ends above $X" / "$Y · N×" → Breakeven · Sell back now → "Buy Up · $25". A quote refused for balance offers "Add funds to buy" |
| F2-tap | Buy Up/Down (grid) | Asset → stake ($10 / $25 / $50 / $100 / Other; below it "Each tap buys one bet for about $25. Max loss $26.25 a tap.", the stake + 5%, rounded up) → tap a cell. Rows: every listed price to beat with a mark, high to low, with the % move. Columns: every end date with a mark, nearest first (day + local time, UTC on hover); the header countdown is to the first. A cell is the Up series when its price to beat is above spot, otherwise Down, never the other side (blank when that series has no mark); a bet you hold keeps its cell after spot crosses it. No wallet: a tap opens Connect. Without a Tap balance (F5): Add funds when the balance is short, else the confirm sheet for that series at the stake. With one: too little in it opens the Tap balance sheet; otherwise the tap buys at once (firm quote, the same checks as the confirm sheet, signed in the browser, auto-collect claim signed too). Taps run one at a time; the cell pulses while busy and pops when filled, one live line under the grid says what happened ("Bought BTC Up $82,000 for $24.91.", "The price moved…" (the cell then shows the new multiple), "Too fast…", "Not enough in your Tap balance.", or why the Tap balance wouldn't open). Leaving Tap or switching wallets drops taps still queued. A cell you hold shows its value now and a ring; "Your taps" lists those bets with "Sell $X" ("Sell unavailable" without a price or while the relay won't quote it), which opens the confirm sheet signed by the Tap key |
| F5 | Tap balance | A second intents account for popup-free taps. Set up: the wallet signs one fixed text (twice the first time on a device, "Set up with your wallet" then "Sign once more to check", since a wallet whose signatures vary would strand the funds); its signature's sha256 is an ed25519 seed whose implicit account (hex of the public key) is the Tap balance. The text is not an intents payload, names the account and network, and says to sign it only on near·options. Every wallet prompt gets its own click, since a browser blocks a wallet popup that doesn't follow one: in a tab where the Tap balance isn't open, the sheet offers "Open with your wallet" (re-deriving its account, so money only goes to the account this wallet controls) before "Move $25 in", which signs one relayed transfer from the wallet; "Move $X to your balance" moves everything back, signed by the Tap key. Each move costs $0.01 (the relay's fee, [rfq.md](rfq.md#moving-between-balances)). Once set up, a tap buys from the Tap balance, signed in the browser with no wallet prompt; with too little in it the tap opens this sheet. Tap positions sit in Positions with a "Tap" tag and collect and sell back with the Tap key; if it won't open, Positions says why. The collect banner takes one balance per click, the main balance first, so the Tap key's prompt never follows the main wallet's. The key's seed lives in `sessionStorage` (kept across reloads, cleared when the tab closes, the wallet disconnects or another wallet connects); a new tab asks for one signature |
| F3 | Positions + sell back | Paid / value now / P&L / countdown / status. Shared across Lite, Pro and Tap. "Sell back" sells to close via RFQ; at the write cutoff (30 min on mainnet) the button turns into a disabled "Sell back closed" |
| F4 | Expiry → paid | "Waiting for the final price, usually about 1 h" → proposed price → "Final price $X. Preparing your payout." for the relay's 60-second safety margin → paid automatically or Collect. A $0 payout shows "Ended $0" as soon as the price is final |

All F2 paths open the same confirm sheet: a firm quote countdown beside "Win up to $Y" (buys) and one signature. After a buy, "You're in" offers auto-collect as the main action ("Turn on auto-collect", one more signature, or "Not now"); once on it says so and the only action is "Done". The first quote also asks for a session signature (no funds move, valid 24 h, kept in memory); renewal waits for the next tap, background refreshes never prompt.

Stretch: "Earn" (covered calls / cash-secured puts), see [ideas/covered-call-vault.md](ideas/covered-call-vault.md).

## Copy

| Concept | Say | Avoid |
|---|---|---|
| call / put | Up / Down | call, put (screen-reader labels only) |
| strike | Price to beat | strike, target |
| expiry | Lite: By Tomorrow 1:30 PM (UTC in date list). Pro header: countdown "18h 46m" + "Ends 1:30 PM" (08:00 UTC on hover). Date chips and Tap columns: Today / Tomorrow / Fri 30. Positions: "Ends Fri 27 Nov, 1:30 PM · 08:00 UTC" | expiry, DTE |
| chance | Estimated % of ending above/below the price to beat. Pro: on the Up / Down buttons only. Lite: on the sentence, on each date row (closest listed price to beat with a mark), and on the strike list | probability, delta, chance of max payout, chance of profit |
| premium | You pay | premium, ask |
| max loss | Max loss $25 | defined risk |
| breakeven | Breakeven $81,512 | |
| best case | Pro: If BTC ends above $83,000 · $62 · 2.4×. Lite: win up to $62 (that capped gross payout) and "Full payout if BTC ends above $83,000". Tap: 2.4× on the cell; its label reads "Up · BTC ends above $83,000 · Tomorrow 1:30 PM · pays up to 2.4×" | 1-sigma, likely, expected, target, profit, guarantee |
| payout at an end price | Chart tooltip "$82,866 → $90" (Pro only) | |
| bid | Sell back now $Y (ticket), Sell back (action), Value now (position) | cash out, mark, bid |
| exercise | Paid automatically / Collect | exercise, redeem, burn |
| settlement price | Final price: (i) next to the Pro countdown, "median of 7 exchanges, averaged over the 30 minutes before the end", linking to the docs | delivery price, TWAP |
| OTM | Ended $0 | expired worthless |

The confirm sheet shows once per buy: "If BTC rises too little or too slowly, this can still lose value. Max loss $X."

## Quote countdown

1. While editing: ticket numbers come from the market makers' [marks](rfq.md#marks) and the Deribit index, refreshed every 5 s.
2. "Buy Up · $25" opens the confirm sheet with a firm quote and a shrinking ring. The visible time runs to `sign_by = mm_deadline - 3s`, not the MM deadline. Buy and sell share one app-level sheet with the original wallet and trade selection. SPA navigation, including Back to Trade or the landing page, keeps that sheet and quote ID mounted.
3. Last 5 s: renew the quote in the background without a wallet prompt. While fetching, disable confirm and show "Refreshing price…": requesting a replacement invalidates the old quote. A failed refresh never restores it.
   - If it is within 0.5% of the price the user last accepted, or better, swap it in with "price refreshed". Refreshes never add up past 0.5% without a tap.
   - If it is worse, stop and ask.
4. While the wallet prompt is open: freeze the ring, show "Confirm in your wallet". Loading, refreshing, signing and submitting block Close, backdrop and Escape; an outstanding quote request cannot be abandoned for a new one. Keyboard focus stays inside the sheet.
5. Signed after `sign_by`: "Price expired while you were signing. Nothing was charged."
6. After submit:
   - settled: "You're in" (buy) or "Sold" (sell back) + tx link;
   - known failed or expired: "Not filled, nothing was charged";
   - publish transport failure or status errors: check the existing quote ID, retrying status errors;
   - unresolved after 60 s: "Trade status unknown" with "Check status" for that same quote, never a new-price action or a no-charge claim. Keep the sheet open across SPA navigation until status resolves so closing it cannot start another buy.

Quote requests have no timeout: a hanging request keeps the sheet locked until it returns. This guard is in memory, not durable across a full page reload or separate tabs.

## Data the UI needs

Sources per field: [apps/web/README.md](../apps/web/README.md#where-data-comes-from). Payout math always comes from the SDK (`longPayout`, same rounding as the contract), never re-implemented in the UI.

## Known constraints

- Option positions are public on `intents.near`. Funds in Confidential Mode on near.com must move to the main balance before trading options.
- Wallets show the raw `token_diff` when signing. Token ids are readable (`BTC-27NOV26-81000_83000-C`). Always show a card that maps 1:1 to the diff before the wallet prompt.
