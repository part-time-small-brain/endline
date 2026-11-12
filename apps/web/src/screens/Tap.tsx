import { callableAt, callMultiple, FREE_CALLS_PER_ROUND, type ListedSeries, nextRound, roundOf, termsOf } from "@endline/sdk";
import { useState } from "react";
import { settlementKey } from "../app/data.tsx";
import type { useTicket } from "../app/useTicket.ts";
import { type Holding, holding, type PositionView } from "../app/usePositions.ts";
import type { QuoteSelection } from "../components/QuoteSheet.tsx";
import { Brackets } from "../components/Brackets.tsx";
import { Cell } from "../components/tap/Cell.tsx";
import { FreeCalls } from "../components/tap/FreeCalls.tsx";
import { RevealCell } from "../components/tap/RevealCell.tsx";
import { RevealNote } from "../components/tap/RevealNote.tsx";
import { TapMode } from "../components/tap/TapMode.tsx";
import { useCalls } from "../hooks/useCalls.ts";
import { PriceLine } from "../components/tap/PriceLine.tsx";
import { AssetPicker } from "../components/trade/AssetPicker.tsx";
import { MarketStats } from "../components/trade/MarketStats.tsx";
import { buildGrid, type GridCell, rowOf } from "../lib/grid.ts";
import { averageEstimate, PHASE_TITLES } from "../lib/reveal.ts";
import { tapBoard } from "../lib/tapBoard.ts";
import { formatMultiple, formatPct, formatPrice, formatUsd, toNumber, toUnits } from "../lib/money.ts";
import { dayLabel, formatClock, formatUtc } from "../lib/time.ts";
import { useWallet } from "../wallet/context.tsx";
import { LABEL } from "../components/label.ts";

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
  const { data, quoteDecimals, symbols, symbol, budget, atMax, picked, setSymbol, setBudget, spot, spotNumber, history, first, priced, loading, empty } = state;
  const { wallet } = useWallet();
  const calls = useCalls();
  const [free, setFreeState] = useState(storedFree);
  const setFree = (on: boolean) => {
    setFreeState(on);
    try {
      localStorage.setItem(FREE_KEY, on ? "1" : "0");
    } catch {}
  };
  const onTap = ({ series, ticket }: GridCell) => {
    if (!wallet) return onConnect();
    if (free) return calls.call(series);
    if (data.balance !== undefined && data.balance < ticket.cost) return onAddFunds();
    onQuote({ wallet, series, side: "buy", size: ticket.size, ...(picked ? { budget } : {}) });
  };
  const callable = (s: ListedSeries) => s.quotable && callableAt(s.expiry, nowSec);
  const callRound = nextRound((data.listing?.series ?? []).filter(callable).map((s) => s.expiry));
  const callableHere = (s: ListedSeries) => callable(s) && roundOf(s.expiry) === callRound;
  const left = FREE_CALLS_PER_ROUND - (data.calls ?? []).filter((c) => roundOf(c.terms.expiry) === callRound).length;
  const settlementOf = (expiry: number) => data.settlements[settlementKey({ underlying: symbol, expiry })] ?? null;
  const { closing, stakes, closingCalls, calledHere, owned, held, listed } = tapBoard(symbol, data.listing?.series ?? [], priced, views ?? [], data.calls ?? [], settlementOf, nowSec);
  const average = closing && spotNumber !== undefined ? averageEstimate(data.minutes?.[symbol] ?? [], closing.expiry, nowSec * 1000, spotNumber) : undefined;
  const closingPrice = closing?.settlement?.price ?? (average === undefined ? undefined : toUnits(average, quoteDecimals));
  const active = views?.filter((v) => v.series.underlying === symbol && v.status === "active") ?? [];
  const grid = spot === undefined ? undefined : buildGrid(listed, spot, budget, data.marks, held, (expiry) => (expiry === closing?.expiry ? (closingPrice ?? spot) : spot));
  const ceiling = grid?.cells.flat().reduce((most, cell) => (cell && cell.series.expiry !== closing?.expiry && cell.ticket.maxCost > most ? cell.ticket.maxCost : most), 0n) ?? 0n;
  const closingColumn = closing && grid ? grid.expiries.indexOf(closing.expiry) : -1;
  const staked = (seriesId: string) => stakes.find((v) => v.series.id === seriesId)?.amount ?? 0n;
  const rows = grid?.strikes.length ?? 0;
  const move = (strike: bigint) => (spotNumber ? formatPct(toNumber(strike, quoteDecimals) / spotNumber - 1) : "");
  const where = (cell: GridCell, strike: bigint) => {
    const up = cell.series.kind === "call";
    return `${up ? "Up" : "Down"} · ${symbol} ends ${up ? "above" : "below"} ${formatPrice(strike, quoteDecimals)}`;
  };
  const freeMultiple = (cell: GridCell) => {
    const ask = calledHere.get(cell.series.id)?.ask ?? data.marks?.[cell.series.id]?.ask;
    return ask === undefined ? undefined : callMultiple(termsOf(cell.series), BigInt(ask));
  };
  const shownMultiple = (cell: GridCell) => (free ? freeMultiple(cell) : cell.multiple);
  const label = (cell: GridCell, strike: bigint, expiry: number, own: Holding | undefined) => {
    const multiple = shownMultiple(cell);
    const pays = multiple === undefined ? "no price right now" : `pays up to ${formatMultiple(multiple)}`;
    const worth = own?.value === undefined ? "" : ` · worth ${formatUsd(own.value, quoteDecimals)}`;
    const pnl = own?.pnl === undefined ? "" : own.pnl > 0n ? ` · up ${formatUsd(own.pnl, quoteDecimals)}` : own.pnl < 0n ? ` · down ${formatUsd(-own.pnl, quoteDecimals)}` : " · even";
    const yoursHere = owned.has(cell.series.id) ? " · you hold this" : calledHere.has(cell.series.id) ? " · you called this" : "";
    return `${where(cell, strike)} · ${dayLabel(expiry, nowSec)} ${formatClock(expiry)} · ${pays}${worth}${pnl}${cell.winning ? " · winning now" : ""}${yoursHere}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 pb-6 lg:px-6 lg:pt-2">
      <div className="grid grid-cols-2 items-end gap-x-4 gap-y-3 lg:flex lg:gap-8">
        {symbols.length > 1 && (
          <div className="col-span-2 lg:self-center">
            <AssetPicker symbols={symbols} spot={data.market?.spot} value={symbol} onChange={setSymbol} />
          </div>
        )}
        <MarketStats symbol={symbol} spot={spot} change={first && spotNumber ? spotNumber / first[1] - 1 : undefined} expiry={grid?.expiries.find((e) => e > nowSec)} nowSec={nowSec} quoteDecimals={quoteDecimals} />
      </div>

      <section aria-label="Tap grid" className="relative rounded-md border border-rule bg-surface p-2 sm:p-4">
        <Brackets color="border-up" />
        {grid && rows > 0 && spot !== undefined && spotNumber !== undefined ? (
          <div className="relative [--axis:4.25rem] [--line:2.5rem] [--row:3.5rem] sm:[--axis:5rem] sm:[--line:30%] sm:[--row:4rem]">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                {free ? "Tap a cell of the next round to call it for free." : "Tap a cell to buy it."} Up pays if {symbol} ends above the row's price, Down if it ends below.
              </caption>
              <colgroup>
                <col className="w-[var(--axis)]" />
                <col className="w-[var(--line)]" />
              </colgroup>
              <thead>
                <tr className="h-10">
                  <th scope="col" className={`text-left ${LABEL}`}>
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
                            value={own?.value === undefined ? undefined : formatUsd(own.value, quoteDecimals)}
                            change={own?.change}
                            called={cell !== undefined && calledHere.has(cell.series.id) && !own}
                            pays={multiple === undefined ? undefined : formatMultiple(multiple)}
                            blocked={free && (cell === undefined || !callableHere(cell.series) || calledHere.has(cell.series.id) || calls.states[cell.series.id]?.status === "busy")}
                            state={cell && free ? calls.states[cell.series.id] : undefined}
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
        <p role="status" className={`min-h-5 px-1 pt-2 text-sm ${free && calls.notice?.failed ? "text-danger" : "text-ink-2"}`}>
          {free && calls.notice?.text}
        </p>
      </section>

      <TapMode free={free} left={left} budget={budget} atMax={atMax} ceiling={ceiling} quoteDecimals={quoteDecimals} onFree={setFree} onBudget={setBudget} />
      {free && <FreeCalls calls={data.calls ?? []} accountId={wallet?.accountId} nowSec={nowSec} quoteDecimals={quoteDecimals} />}
    </div>
  );
}
