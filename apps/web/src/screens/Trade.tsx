import { capPrice } from "@endline/sdk";
import type { PositionView } from "../app/usePositions.ts";
import { useTicket } from "../app/useTicket.ts";
import { Brackets } from "../components/Brackets.tsx";
import { Button } from "../components/Button.tsx";
import { Notice } from "../components/Notice.tsx";
import type { QuoteSelection } from "../components/QuoteSheet.tsx";
import { Summary } from "../components/Summary.tsx";
import { AmountPicker } from "../components/trade/AmountPicker.tsx";
import { AssetPicker } from "../components/trade/AssetPicker.tsx";
import { DirectionPicker } from "../components/trade/DirectionPicker.tsx";
import { ExpiryPicker } from "../components/trade/ExpiryPicker.tsx";
import { HorizonChart } from "../components/trade/HorizonChart.tsx";
import { MarketStats } from "../components/trade/MarketStats.tsx";
import { TargetPicker } from "../components/trade/TargetPicker.tsx";
import { formatUsd, toNumber } from "../lib/money.ts";
import { goodCase } from "../lib/ticket.ts";
import type { TradeMode } from "../lib/tradeMode.ts";
import { useWallet } from "../wallet/context.tsx";
import { Lite } from "../components/trade/Lite.tsx";
import { Tap } from "./Tap.tsx";

interface Props {
  mode: TradeMode;
  nowSec: number;
  views: PositionView[] | undefined;
  onConnect: () => void;
  onAddFunds: () => void;
  onQuote: (selection: QuoteSelection) => void;
}

export function Trade({ mode, nowSec, views, onConnect, onAddFunds, onQuote }: Props) {
  const { wallet } = useWallet();
  const state = useTicket(nowSec);
  const {
    data, quoteDecimals, unit, balance, symbols, symbol, kind, expiry, budget,
    setSymbol, setKind, setExpiry, setSeries, setBudget,
    spotNumber, spot, history, usdOf, payoutAt, up, strikes, choices,
    series, current, vol, reference, sides, first, empty, expiries, notice,
  } = state;
  if (notice) return <Centered {...notice} />;
  const action = !wallet ? (
    <Button size="lg" onClick={onConnect}>
      Connect wallet
    </Button>
  ) : current && balance !== undefined && balance < current.cost ? (
    <Button size="lg" onClick={onAddFunds}>
      Add funds to buy
    </Button>
  ) : (
    <Button size="lg" tone={up ? "up" : "down"} disabled={!current || current.size === 0n} onClick={() => wallet && series && current && onQuote({ wallet, series, side: "buy", size: current.size, budget })}>
      {budget < unit ? "Enter a valid amount" : `Buy ${up ? "Up" : "Down"} · ${formatUsd(current?.size ? current.cost : budget, quoteDecimals, "up").replace(/\.00$/, "")}`}
    </Button>
  );

  return (
    <>
      {mode === "tap" ? (
        <Tap state={state} nowSec={nowSec} views={views} onConnect={onConnect} onAddFunds={onAddFunds} onQuote={onQuote} />
      ) : mode === "lite" ? (
        <div className="mx-auto w-full max-w-2xl flex-1 px-4 pt-3 lg:px-6 lg:pt-6">
          <Lite state={state} nowSec={nowSec} action={action} stickyAction />
        </div>
      ) : (
        <div data-side={up ? "up" : "down"} className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-6 lg:px-6 lg:pt-2 pb-32 lg:pb-6">
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <div className="grid grid-cols-2 items-end gap-x-4 gap-y-3 lg:flex lg:gap-8">
              {symbols.length > 1 && (
                <div className="col-span-2 lg:self-center">
                  <AssetPicker symbols={symbols} spot={data.market?.spot} value={symbol} onChange={setSymbol} />
                </div>
              )}
              <MarketStats symbol={symbol} spot={spot} change={first && spotNumber ? spotNumber / first[1] - 1 : undefined} expiry={expiry} nowSec={nowSec} quoteDecimals={quoteDecimals} />
            </div>
            <div className="h-[340px] shrink-0 overflow-hidden rounded-md border border-rule bg-surface lg:h-auto lg:min-h-0 lg:flex-1">
              {spotNumber !== undefined && vol !== undefined && series && current ? (
                <HorizonChart
                  symbol={symbol}
                  kind={kind}
                  history={history}
                  spot={spotNumber}
                  vol={vol}
                  nowSec={nowSec}
                  expiry={series.expiry}
                  strikes={strikes.map(usdOf)}
                  strikeIndex={strikes.indexOf(series)}
                  focus={[...choices.map((c) => usdOf(strikes[c.index] ?? series)), toNumber(capPrice(current.terms), quoteDecimals)]}
                  breakeven={current.breakeven === null ? null : toNumber(current.breakeven, quoteDecimals)}
                  quoteDecimals={quoteDecimals}
                  payout={(end) => payoutAt(current, end)}
                  reference={(end) => (reference ? payoutAt(reference, end) : 0n)}
                  onStrike={(index) => setSeries(strikes[index]?.id)}
                />
              ) : (
                <p className="grid h-full place-items-center px-6 text-center text-sm text-ink-2" role="status">
                  {empty}
                </p>
              )}
            </div>
          </div>

          <div className="relative flex min-h-0 flex-col lg:max-h-full lg:self-start">
            <Brackets color="border-side" />
            <aside aria-label="Order" className="flex min-h-0 flex-col gap-4 rounded-md border border-rule bg-surface p-4 lg:gap-3.5 lg:overflow-y-auto lg:p-6">
              <DirectionPicker sides={sides} value={kind} onChange={setKind} />
              {expiries.length > 0 && <ExpiryPicker expiries={expiries} value={expiry} nowSec={nowSec} onChange={setExpiry} />}
              {series && current && spot !== undefined && (
                <>
                  <TargetPicker
                    strikes={strikes.map((s) => BigInt(s.strike))}
                    index={strikes.indexOf(series)}
                    presets={choices}
                    spot={spot}
                    quoteDecimals={quoteDecimals}
                    onChange={(index) => setSeries(strikes[index]?.id)}
                  />
                  <AmountPicker value={budget} quoteDecimals={quoteDecimals} onChange={setBudget} />
                  <Summary up={up} ticket={current} quoteDecimals={quoteDecimals} symbol={symbol} goodCase={goodCase(current)} />
                </>
              )}
              <div className="fixed inset-x-0 bottom-0 z-30 bg-page/90 px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] backdrop-blur-lg lg:static lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
                {action}
              </div>
            </aside>
          </div>
        </div>
      )}
    </>
  );
}

function Centered({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-16">
      <Notice title={title} body={body} />
    </div>
  );
}
