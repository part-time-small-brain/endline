import { callMultiple, FREE_CALLS_PER_ROUND, roundOf, termsOf, TWAP_WINDOW_SEC } from "@endline/sdk";
import { useState } from "react";
import { settlementKey } from "../app/data.tsx";
import type { useTicket } from "../app/useTicket.ts";
import { type Holding, holding, type PositionView } from "../app/usePositions.ts";
import type { QuoteSelection } from "../components/QuoteSheet.tsx";
import { Brackets } from "../components/Brackets.tsx";
import { Button } from "../components/Button.tsx";
import { Cell } from "../components/tap/Cell.tsx";
import { FreeCalls } from "../components/tap/FreeCalls.tsx";
import { RevealCell } from "../components/tap/RevealCell.tsx";
import { RevealNote } from "../components/tap/RevealNote.tsx";
import { TapMode } from "../components/tap/TapMode.tsx";
import { TapSheet } from "../components/tap/TapSheet.tsx";
import { useCalls } from "../hooks/useCalls.ts";
import { useTaps } from "../hooks/useTaps.ts";
import { PriceLine } from "../components/tap/PriceLine.tsx";
import { AssetPicker } from "../components/trade/AssetPicker.tsx";
import { MarketStats } from "../components/trade/MarketStats.tsx";
import { buildGrid, type GridCell, rowOf } from "../lib/grid.ts";
import { averageEstimate, closingOf, PHASE_TITLES } from "../lib/reveal.ts";
import { formatMultiple, formatPct, formatPrice, formatUsd, toNumber, toUnits } from "../lib/money.ts";
import { seriesTitle } from "../lib/labels.ts";
import { dayLabel, formatClock, formatUtc } from "../lib/time.ts";
import { useWallet } from "../wallet/context.tsx";
import { useTap, useTapPayer } from "../wallet/tapBalance.tsx";

const FREE_KEY = "tap-free";

function storedFree(): boolean {
  try {
    return localStorage.getItem(FREE_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  state: ReturnType<typeof useTicket>;
  nowSec: number;
  views: PositionView[] | undefined;
  onConnect: () => void;
  onAddFunds: () => void;
  onQuote: (selection: QuoteSelection) => void;
}

export function Tap({ state, nowSec, views, onConnect, onAddFunds, onQuote }: Props) {
  const { data, quoteDecimals, symbols, symbol, budget, setSymbol, setBudget, spot, spotNumber, history, first, priced, loading, empty } = state;
  const { wallet } = useWallet();
  const tapBalance = useTap();
  const [sheet, setSheet] = useState(false);
  const { payer, error: unlockError } = useTapPayer();
  const taps = useTaps(tapBalance.accountId);
  const calls = useCalls();
  const [free, setFreeState] = useState(storedFree);
  const setFree = (on: boolean) => {
    setFreeState(on);
    try {
      localStorage.setItem(FREE_KEY, on ? "1" : "0");
    } catch {}
  };
  const onTap = async ({ series, ticket, multiple }: GridCell) => {
    if (!wallet) return onConnect();
    if (free) return calls.call(series);
    if (tapBalance.accountId === undefined) {
      if (data.balance !== undefined && data.balance < ticket.cost) return onAddFunds();
      return onQuote({ wallet, series, side: "buy", size: ticket.size, budget });
    }
    if ((data.tapBalance ?? 0n) < ticket.cost) return setSheet(true);
    const tapWallet = await payer();
    if (tapWallet && multiple !== undefined) taps.tap(tapWallet, { series, size: ticket.size, stake: budget, multiple });
  };
  const sell = async (series: GridCell["series"], size: bigint) => {
    const tapWallet = await payer();
    if (tapWallet) onQuote({ wallet: tapWallet, series, side: "sell", size });
  };
  const yours = views?.filter((v) => v.series.underlying === symbol) ?? [];
  const here = data.listing?.series.filter((s) => s.underlying === symbol) ?? [];
  const nextRound = (data.listing?.series ?? []).filter((s) => s.quotable && nowSec < s.expiry - TWAP_WINDOW_SEC).map((s) => roundOf(s.expiry)).sort()[0];
  const left = FREE_CALLS_PER_ROUND - (data.calls ?? []).filter((c) => roundOf(c.terms.expiry) === nextRound).length;
  const calledHere = new Map((data.calls ?? []).filter((c) => c.terms.underlying === symbol).map((c) => [c.series_id, c]));
  const settlementOf = (expiry: number) => data.settlements[settlementKey({ underlying: symbol, expiry })] ?? null;
  const closing = closingOf(here.map((s) => s.expiry), [...yours.map((v) => v.series.expiry), ...[...calledHere.values()].map((c) => c.terms.expiry)], settlementOf, nowSec);
  const stakes = closing ? yours.filter((v) => v.series.expiry === closing.expiry) : [];
  const closingCalls = [...calledHere.values()].filter((c) => c.terms.expiry === closing?.expiry);
  const average = closing && spotNumber !== undefined ? averageEstimate(data.minutes?.[symbol] ?? [], closing.expiry, nowSec * 1000, spotNumber) : undefined;
  const closingPrice = closing?.settlement?.price ?? (average === undefined ? undefined : toUnits(average, quoteDecimals));
  const active = yours.filter((v) => v.status === "active");
  const mine = active.filter((v) => v.tap);
  const kept = yours.filter((v) => v.status === "active" || v.series.expiry === closing?.expiry);
  const owned = new Set(kept.map((v) => v.series.id));
  const called = here.filter((s) => calledHere.has(s.id) && (s.expiry === closing?.expiry || roundOf(s.expiry) === nextRound));
  const held = new Set([...owned, ...called.map((s) => s.id)]);
  const open = priced.filter((s) => s.underlying === symbol && s.expiry !== closing?.expiry && !held.has(s.id));
  const rowsElsewhere = new Set([...open, ...kept.map((v) => v.series), ...called].map((s) => s.strike));
  const listed = [...open, ...here.filter((s) => s.expiry === closing?.expiry && !held.has(s.id) && rowsElsewhere.has(s.strike)), ...kept.map((v) => v.series), ...called];
  const grid = spot === undefined ? undefined : buildGrid(listed, spot, budget, data.marks, held, (expiry) => (expiry === closing?.expiry ? (closingPrice ?? spot) : spot));
  const closingColumn = closing && grid ? grid.expiries.indexOf(closing.expiry) : -1;
  const staked = (seriesId: string) => stakes.filter((v) => v.series.id === seriesId).reduce((total, v) => total + v.amount, 0n);
  const rows = grid?.strikes.length ?? 0;
  const formatMoney = (value: bigint | undefined) => (value === undefined ? undefined : formatUsd(value, quoteDecimals));
  const move = (strike: bigint) => (spotNumber ? formatPct(toNumber(strike, quoteDecimals) / spotNumber - 1) : "");
  const where = (cell: GridCell, strike: bigint) => {
    const up = cell.series.kind === "call";
    return `${up ? "Up" : "Down"} · ${symbol} ends ${up ? "above" : "below"} ${formatPrice(strike, quoteDecimals)}`;
  };
  const freeMultiple = (cell: GridCell) => {
    const ask = calledHere.get(cell.series.id)?.ask ?? data.marks?.[cell.series.id]?.ask;
    return ask === undefined ? undefined : callMultiple(termsOf(cell.series), BigInt(ask));
  };
  const shownMultiple = (cell: GridCell) => (free || (calledHere.has(cell.series.id) && !owned.has(cell.series.id)) ? freeMultiple(cell) : cell.multiple);
  const label = (cell: GridCell, strike: bigint, expiry: number, own: Holding | undefined) => {
    const multiple = shownMultiple(cell);
    const pays = multiple === undefined ? "no price right now" : `pays up to ${formatMultiple(multiple)}`;
    const worth = own?.value === undefined ? "" : ` · worth ${formatUsd(own.value, quoteDecimals)}`;
    const pnl = own?.pnl === undefined ? "" : own.pnl > 0n ? ` · up ${formatUsd(own.pnl, quoteDecimals)}` : own.pnl < 0n ? ` · down ${formatUsd(-own.pnl, quoteDecimals)}` : " · even";
    const yoursHere = owned.has(cell.series.id) ? " · you hold this" : calledHere.has(cell.series.id) ? " · you called this" : "";
    return `${where(cell, strike)} · ${dayLabel(expiry, nowSec)} ${formatClock(expiry)} · ${pays}${worth}${pnl}${cell.winning ? " · winning now" : ""}${yoursHere}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 lg:px-6 lg:pt-2">
      <div className="grid grid-cols-2 items-end gap-x-4 gap-y-3 lg:flex lg:gap-8">
        <div className="col-span-2 lg:self-center">
          <AssetPicker symbols={symbols} spot={data.market?.spot} value={symbol} onChange={setSymbol} />
        </div>
        <MarketStats symbol={symbol} spot={spot} change={first && spotNumber ? spotNumber / first[1] - 1 : undefined} expiry={grid?.expiries.find((e) => e > nowSec)} nowSec={nowSec} quoteDecimals={quoteDecimals} />
      </div>

      <section aria-label="Tap grid" className="relative rounded-md border border-rule bg-surface p-2 sm:p-4">
        <Brackets color="border-up" />
        {grid && rows > 0 && spot !== undefined && spotNumber !== undefined ? (
          <div className="relative [--axis:4.25rem] [--line:2.5rem] [--row:3.5rem] sm:[--axis:5rem] sm:[--line:30%] sm:[--row:4rem]">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">Tap a cell to buy it. Up pays if {symbol} ends above the row's price, Down if it ends below.</caption>
              <colgroup>
                <col className="w-[var(--axis)]" />
                <col className="w-[var(--line)]" />
              </colgroup>
              <thead>
                <tr className="h-10">
                  <th scope="col" className="text-left font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">
                    Price to beat
                  </th>
                  <td aria-hidden="true" />
                  {grid.expiries.map((expiry) => (
                    <th key={expiry} scope="col" title={formatUtc(expiry)} className={`overflow-hidden font-mono text-[8px] leading-4 font-medium tracking-normal whitespace-nowrap uppercase sm:text-[10px] sm:tracking-[0.1em] ${expiry === closing?.expiry ? "text-teal" : "text-ink-2"}`}>
                      {expiry === closing?.expiry ? PHASE_TITLES[closing.phase] : dayLabel(expiry, nowSec)}
                      <span className="block tracking-normal text-ink-3 normal-case">{formatClock(expiry)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.strikes.map((strike, r) => (
                  <tr key={strike.toString()}>
                    <th scope="row" className="h-[var(--row)] text-left font-mono text-[13px] leading-5 font-medium">
                      {formatPrice(strike, quoteDecimals)}
                      <span className="block text-[11px] font-normal text-ink-3">{move(strike)}</span>
                    </th>
                    {r === 0 && (
                      <td rowSpan={rows} aria-hidden="true" className="relative p-0">
                        <div className="absolute inset-y-0 right-2 left-0">
                          <PriceLine history={history} spot={spotNumber} nowMs={nowSec * 1000} rows={rows} rowAt={(price) => rowOf(grid.strikes, toUnits(price, quoteDecimals))} />
                        </div>
                      </td>
                    )}
                    {grid.cells[r]?.map((cell, c) => {
                      const expiry = grid.expiries[c] ?? 0;
                      if (closing && expiry === closing.expiry) {
                        return (
                          <td key={cell?.series.id ?? expiry} className="h-[var(--row)] p-0.5">
                            {cell && (owned.has(cell.series.id) || calledHere.has(cell.series.id)) ? (
                              <RevealCell
                                series={cell.series}
                                phase={closing.phase}
                                price={closingPrice}
                                amount={staked(cell.series.id)}
                                call={owned.has(cell.series.id) ? undefined : calledHere.get(cell.series.id)}
                                where={where(cell, strike)}
                                quoteDecimals={quoteDecimals}
                              />
                            ) : (
                              <span className="block size-full rounded-md border border-rule/40" aria-hidden="true" />
                            )}
                          </td>
                        );
                      }
                      const own = cell && owned.has(cell.series.id) ? holding(active, cell.series.id) : undefined;
                      const multiple = cell && shownMultiple(cell);
                      return (
                        <td key={cell?.series.id ?? expiry} className="h-[var(--row)] p-0.5">
                          <Cell
                            cell={cell}
                            label={cell ? label(cell, strike, expiry, own) : ""}
                            value={formatMoney(own?.value)}
                            change={own?.change}
                            called={cell !== undefined && calledHere.has(cell.series.id) && !own}
                            pays={multiple === undefined ? undefined : formatMultiple(multiple)}
                            blocked={free && (roundOf(expiry) !== nextRound || (cell !== undefined && calledHere.has(cell.series.id)))}
                            state={cell && (free ? calls.states : taps.states)[cell.series.id]}
                            onTap={onTap}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-0 left-[calc(var(--axis)+var(--line)-0.5rem)] border-t border-dashed border-teal opacity-70 transition-[top] duration-700 ease-out"
              style={{ top: `calc(2.5rem + var(--row) * ${rowOf(grid.strikes, spot) + 0.5})` }}
            />
            {closingColumn >= 0 && closingPrice !== undefined && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute border-t-2 border-teal shadow-[0_0_10px_var(--teal)] transition-[top] duration-700 ease-out"
                style={{
                  top: `calc(2.5rem + var(--row) * ${rowOf(grid.strikes, closingPrice) + 0.5})`,
                  left: `calc(var(--axis) + var(--line) + (100% - var(--axis) - var(--line)) * ${closingColumn / grid.expiries.length})`,
                  width: `calc((100% - var(--axis) - var(--line)) / ${grid.expiries.length})`,
                }}
              />
            )}
          </div>
        ) : (
          <p className="grid h-64 place-items-center px-6 text-center text-sm text-ink-2" role="status">
            {spot !== undefined && !loading ? "No prices right now" : empty}
          </p>
        )}
        {closing && <RevealNote closing={closing} price={closingPrice} stakes={stakes} calls={closingCalls} quoteDecimals={quoteDecimals} />}
        <p role="status" className={`min-h-5 px-1 pt-2 text-sm ${unlockError || (free ? calls : taps).notice?.failed ? "text-danger" : "text-ink-2"}`}>
          {unlockError ?? (free ? calls : taps).notice?.text}
        </p>
      </section>

      {wallet && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-rule bg-surface p-4 sm:px-6">
          <p className="min-w-0">
            <span className="flex items-center gap-2 font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-teal shadow-[0_0_8px_var(--teal)]" />
              Tap balance
            </span>
            <span className="mt-1 block font-mono text-xl font-medium">{tapBalance.accountId === undefined ? "Not set up" : formatUsd(data.tapBalance ?? 0n, quoteDecimals)}</span>
          </p>
          <Button onClick={() => setSheet(true)}>{tapBalance.accountId === undefined ? "Set up" : "Top up or move"}</Button>
        </div>
      )}
      {sheet && <TapSheet onClose={() => setSheet(false)} />}
      {mine.length > 0 && (
        <section aria-label="Your taps" className="flex flex-col gap-2 rounded-md border border-rule bg-surface p-4 sm:p-6">
          <h2 className="font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">Your taps</h2>
          {mine.map((v) => (
            <div key={v.series.id} className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm">
                {seriesTitle(v.series, quoteDecimals)} <span className="font-mono text-xs text-ink-3">· {dayLabel(v.series.expiry, nowSec)} · paid {formatMoney(v.paid)}</span>
              </p>
              <Button tone="ghost" disabled={!v.valueNow || !v.series.quotable} onClick={() => sell(v.series, v.held)}>
                {v.valueNow && v.series.quotable ? `Sell ${formatMoney(v.valueNow)}` : "Sell unavailable"}
              </Button>
            </div>
          ))}
        </section>
      )}

      <TapMode free={free} left={left} budget={budget} quoteDecimals={quoteDecimals} onFree={setFree} onBudget={setBudget} />
      {free && <FreeCalls calls={data.calls ?? []} left={left} accountId={wallet?.accountId} nowSec={nowSec} quoteDecimals={quoteDecimals} />}
      <p className="pb-6 text-center font-mono text-[10px] font-medium tracking-[0.14em] text-ink-3 uppercase">Signed in your browser · settled on NEAR Intents</p>
    </div>
  );
}
