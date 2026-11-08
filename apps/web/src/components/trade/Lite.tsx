import { capPrice, maxPayout } from "@endline/sdk";
import { CaretDown, Info } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { useTicket } from "../../app/useTicket.ts";
import { assetName } from "../../lib/labels.ts";
import { formatChance, formatMultiple, formatPct, formatPrice, formatUsd, toNumber, toUnits } from "../../lib/money.ts";
import { payoutMultiple } from "../../lib/ticket.ts";
import { dayLabel, formatClock, formatUtc } from "../../lib/time.ts";
import { Brackets } from "../Brackets.tsx";
import { pickWithArrows } from "../Chips.tsx";
import { SideGlyph } from "../Glyphs.tsx";
import { LABEL } from "../label.ts";
import { Popover } from "../Popover.tsx";
import { AmountPicker } from "./AmountPicker.tsx";
import { ASSET_ICONS } from "./AssetPicker.tsx";

interface Props {
  state: ReturnType<typeof useTicket>;
  nowSec: number;
  action: ReactNode;
  stickyAction?: boolean;
}

const legend = "before:pointer-events-none before:absolute before:-top-[0.4375rem] before:left-2 before:bg-surface before:px-1 before:font-mono before:text-[0.625rem] before:leading-[0.875rem] before:font-medium before:tracking-[0.14em] before:uppercase";

const Caret = () => <CaretDown size="0.44em" weight="bold" aria-hidden="true" className="shrink-0 opacity-50" />;

function Meter({ chance, lit, className }: { chance: number; lit: string; className: string }) {
  const on = Math.round(chance * 10);
  return (
    <span aria-hidden="true" className={`grid grid-cols-10 gap-0.5 ${className}`}>
      {Array.from({ length: 10 }, (_, i) => <span key={i} className={`h-2.5 rounded-[1px] ${i < on ? lit : "bg-ink/20"}`} />)}
    </span>
  );
}

export function Lite({ state, nowSec, action, stickyAction }: Props) {
  const {
    data, quoteDecimals, unit, symbol, symbols, kind, expiry, budget,
    setSymbol, setKind, setExpiry, setSeries, setBudget,
    spot, up, strikes, series, current, sides, empty, dates, odds,
  } = state;
  const direction = up ? "above" : "below";
  const valid = current && current.size > 0n;
  const payout = valid ? maxPayout(current.terms, current.size) : undefined;
  const multiple = valid ? payoutMultiple(current) : undefined;
  const strike = series ? BigInt(series.strike) : undefined;
  const pinned = stickyAction ? "[@media(min-height:44rem)]:scroll-mb-40" : "";
  const chip = `relative inline-flex min-h-11 max-w-full items-center gap-[0.25em] rounded-md border px-[0.4em] py-[0.08em] align-middle leading-tight font-semibold transition-colors ${pinned} ${legend}`;
  const slot = `${chip} border-ink/20 text-ink before:text-ink-3 hover:border-ink/45 hover:bg-well aria-expanded:border-ink`;
  const panel = "w-96 max-w-[calc(100vw-2rem)] rounded-md bg-surface p-2 font-sans text-sm font-normal leading-5 tracking-normal text-ink normal-case shadow-[0_24px_64px_rgb(0_0_0/0.6)]";
  const heading = `mb-1 px-3 pt-2 pb-1 ${LABEL}`;
  const row = "flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors";
  const picked = (selected: boolean) => (selected ? "bg-side-field shadow-[inset_0_0_0_1px_var(--side)]" : "hover:bg-well");
  const move = (price: bigint) => spot !== undefined && spot > 0n ? formatPct(toNumber(price - spot, quoteDecimals) / toNumber(spot, quoteDecimals)) : "—";
  const endLabel = expiry !== undefined ? `${dayLabel(expiry, nowSec)} ${formatClock(expiry)}` : "Choose date";
  const amountLabel = budget >= unit ? formatUsd(budget, quoteDecimals).replace(/\.00$/, "") : "—";
  const priceLabel = strike !== undefined ? formatPrice(strike, quoteDecimals) : "—";
  const spotLabel = spot !== undefined ? formatPrice(spot, quoteDecimals) : "—";
  const chanceLabel = series ? formatChance(odds(series)) : "—";
  const ladder = [...strikes].reverse();
  const onTop = (s: (typeof strikes)[number]) => spot === undefined || BigInt(s.strike) >= spot;
  const nowLine = (
    <div aria-hidden="true" className="flex h-6 items-center gap-2 px-3 font-mono text-[0.625rem] font-medium tracking-[0.12em] text-teal uppercase">
      <span className="size-1.5 rounded-full bg-teal shadow-[0_0_8px_var(--teal)]" />
      Now {spotLabel}
      <span className="flex-1 border-t border-dashed border-teal/60" />
    </div>
  );
  const rung = (s: (typeof strikes)[number]) => {
    const selected = s.id === series?.id;
    const chance = odds(s);
    return (
      <button
        key={s.id}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        onClick={() => setSeries(s.id)}
        className={`${row} grid grid-cols-[minmax(0,1fr)_auto_2.75rem] ${picked(selected)}`}
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-base font-semibold ${selected ? "text-side-ink" : ""}`}>{formatPrice(BigInt(s.strike), quoteDecimals)}</span>
          <span className="font-mono text-xs text-ink-3">{move(BigInt(s.strike))}</span>
        </span>
        <Meter chance={chance} lit={selected ? "bg-side" : "bg-ink-2"} className="w-14 min-[375px]:w-[5.25rem]" />
        <span className={`text-right font-mono font-medium ${selected ? "text-side-ink" : ""}`}>{formatChance(chance)}<span className="sr-only"> est. chance</span></span>
      </button>
    );
  };
  const Glyph = ASSET_ICONS[symbol];

  return (
    <div data-side={up ? "up" : "down"}>
      <section aria-label="Trade ticket">
        <div className="relative rounded-md border border-rule bg-surface p-4 min-[375px]:px-[1.125rem] sm:p-6 lg:p-8">
          <Brackets color="border-side" />

          <div className="flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
            <span className="size-1.5 rounded-full bg-teal shadow-[0_0_8px_var(--teal)]" aria-hidden="true" />
            <span>{symbol} now <span className="text-[0.8125rem] tracking-normal text-ink">{spotLabel}</span></span>
          </div>

          <div aria-label="Trade sentence" className="mt-3 text-xl leading-[max(3.875rem,2em)] font-medium tracking-tight text-ink-2 min-[375px]:text-2xl md:text-[1.75rem] lg:text-[2rem]">
            By{" "}
            <span className="whitespace-nowrap">
              <Popover fit label="End date" description={endLabel} button={<>{endLabel}<Caret /></>} buttonClassName={`${slot} before:content-['End_date']`} panelClassName={panel}>
                <div className={heading}>End date · local time</div>
                <div role="radiogroup" aria-label="End date options" onKeyDown={pickWithArrows}>
                  {dates.map(({ end, closest }) => (
                    <button
                      key={end}
                      type="button"
                      role="radio"
                      aria-checked={end === expiry}
                      tabIndex={end === expiry ? 0 : -1}
                      disabled={!closest}
                      onClick={() => {
                        if (!closest) return;
                        setExpiry(end);
                        setSeries(closest.id);
                      }}
                      className={`${row} ${picked(end === expiry)} disabled:opacity-40`}
                    >
                      <span>
                        <span className="block font-semibold">{dayLabel(end, nowSec)} · {formatClock(end)}</span>
                        <span className="block font-mono text-xs text-ink-3">{formatUtc(end)}</span>
                      </span>
                      <span className="shrink-0 text-right font-mono text-sm">{closest ? formatChance(odds(closest)) : "—"}<span className={`block ${LABEL}`}>est. chance</span></span>
                    </button>
                  ))}
                  {dates.length === 0 && <p className="px-3 py-2 text-ink-2">{empty}</p>}
                </div>
              </Popover>
              ,
            </span>{" "}
            {symbols.length > 1 ? (
              <Popover
                fit
                label="Trade asset"
                description={symbol}
                button={<>{Glyph && <Glyph size="0.78em" weight="bold" aria-hidden="true" className="shrink-0" />}{symbol}<Caret /></>}
                buttonClassName={`${slot} before:content-['Asset']`}
                panelClassName={panel}
              >
                <div className={heading}>Asset</div>
                <div role="radiogroup" aria-label="Asset" onKeyDown={pickWithArrows}>
                  {symbols.map((s) => {
                    const Icon = ASSET_ICONS[s];
                    const price = data.market?.spot[s];
                    return (
                      <button key={s} type="button" role="radio" aria-checked={s === symbol} tabIndex={s === symbol ? 0 : -1} onClick={() => setSymbol(s)} className={`${row} ${picked(s === symbol)}`}>
                        <span className="flex items-center gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-ink/20 text-ink" aria-hidden="true">
                            {Icon ? <Icon size={18} weight="bold" /> : s.slice(0, 1)}
                          </span>
                          <span>
                            <span className="block font-semibold">{s}</span>
                            <span className="block text-xs text-ink-3">{assetName(s)}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-right font-mono">{price ? formatPrice(toUnits(price, quoteDecimals), quoteDecimals) : "…"}</span>
                      </button>
                    );
                  })}
                </div>
              </Popover>
            ) : (
              <span className="inline-flex items-center gap-[0.25em] align-middle font-semibold">
                {Glyph && <Glyph size="0.78em" weight="bold" aria-hidden="true" className="shrink-0" />}
                {symbol}
              </span>
            )}{" "}
            ends{" "}
            <Popover
              fit
              label="Trade direction"
              description={`${up ? "Up" : "Down"}, ends ${direction}`}
              button={<>{direction} <span aria-hidden="true">{up ? "↗" : "↘"}</span><Caret /></>}
              buttonClassName={`${chip} border-side bg-side-field text-side-ink before:text-side-ink hover:bg-side hover:text-on-side aria-expanded:bg-side aria-expanded:text-on-side before:content-['Direction']`}
              panelClassName={panel}
            >
              <div className={heading}>Direction</div>
              <div role="radiogroup" aria-label="Direction" onKeyDown={pickWithArrows}>
                {sides.map(({ kind: k, chance }) => (
                  <button key={k} type="button" role="radio" aria-checked={k === kind} tabIndex={k === kind ? 0 : -1} onClick={() => setKind(k)} className={`${row} ${picked(k === kind)}`}>
                    <span className={`flex items-center gap-3 ${k === "call" ? "text-up-ink" : "text-down-ink"}`}>
                      <SideGlyph kind={k} size={20} />
                      <span>
                        <span className="block font-semibold">{k === "call" ? "Up" : "Down"}</span>
                        <span className="block text-xs text-ink-3">Ends {k === "call" ? "above" : "below"} the price to beat</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-sm">{chance !== undefined ? formatChance(chance) : "—"}<span className={`block ${LABEL}`}>est. chance</span></span>
                  </button>
                ))}
              </div>
            </Popover>{" "}
            <span className="whitespace-nowrap">
              <Popover
                fit
                label="Price to beat"
                description={`${priceLabel}, ${strike !== undefined ? move(strike) : "—"} from current price`}
                button={<>{priceLabel}{strike !== undefined && <span className="font-mono text-[0.5em] font-medium tracking-normal text-ink-3">{move(strike)}</span>}<Caret /></>}
                buttonClassName={`${slot} before:content-['Price_to_beat']`}
                panelClassName={panel}
              >
                <div className={heading}>Price to beat · {symbol} ends {direction}</div>
                <div aria-hidden="true" className={`flex justify-between border-b border-rule px-3 pb-1.5 ${LABEL}`}><span>Price · move</span><span>Est. chance</span></div>
                <div role="radiogroup" aria-label="Prices to beat" onKeyDown={pickWithArrows} className="mt-1 flex flex-col gap-0.5">
                  {ladder.filter(onTop).map(rung)}
                  {spot !== undefined && ladder.length > 0 && nowLine}
                  {ladder.filter((s) => !onTop(s)).map(rung)}
                </div>
                {strikes.length === 0 && <p className="px-3 py-2 text-ink-2">{empty}</p>}
                <p className="px-3 pt-2 pb-1 text-xs text-ink-3">Estimated from market prices and volatility. Not the chance of full payout or profit.</p>
              </Popover>
              .
            </span>
            <span className="block">
              I put{" "}
              <span className="whitespace-nowrap">
                <Popover fit preferAbove label="Trade amount" description={amountLabel} button={<>{amountLabel}<Caret /></>} buttonClassName={`${slot} min-w-[4.5rem] before:content-['Amount']`} panelClassName={panel}>
                  <AmountPicker value={budget} quoteDecimals={quoteDecimals} onChange={setBudget} />
                </Popover>
                ,
              </span>{" "}
              <span className="whitespace-nowrap">
                I win up to{" "}
                <output aria-label="Maximum payout" aria-live="off" className="align-baseline text-[1.4em] font-bold tracking-[-0.03em] text-side-ink [text-shadow:0_0_22px_var(--side-glow)]">
                  {payout !== undefined ? formatUsd(payout, quoteDecimals).replace(/\.00$/, "") : "—"}
                </output>
                .
              </span>
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 border-t border-rule">
            <div className="border-r border-b border-rule py-3 pr-3">
              <dt className={LABEL}>Payout</dt>
              <dd className="mt-1.5 font-mono text-[1.375rem] leading-7 font-medium text-ink">{multiple !== undefined ? formatMultiple(multiple) : "—"}</dd>
            </div>
            <div className="border-b border-rule py-3 pl-3.5">
              <dt className={`flex items-center gap-1 ${LABEL}`}>
                Est. chance
                <Popover
                  fit
                  label="About estimated chance"
                  description={`${chanceLabel} estimated chance`}
                  button={<Info size={14} aria-hidden="true" />}
                  buttonClassName={`-my-4 -mr-3 -ml-2.5 grid size-11 place-items-center rounded-md text-ink-3 transition-colors hover:text-ink aria-expanded:text-ink ${pinned}`}
                  panelClassName={panel}
                >
                  <span className="block p-1">
                    <p>Estimated chance that {symbol} ends {direction} the price to beat, based on current market prices and volatility. Not the chance of receiving the maximum payout or making a profit.</p>
                    <p className="mt-2 text-ink-2">Maximum payout includes your stake. Estimates can change.</p>
                  </span>
                </Popover>
              </dt>
              <dd className="mt-1.5 flex items-center gap-2.5">
                <span className="font-mono text-[1.375rem] leading-7 font-medium text-ink">{chanceLabel}</span>
                {series && <Meter chance={odds(series)} lit="bg-side" className="min-w-0 flex-1" />}
              </dd>
            </div>
            {series && current && (
              <div className="col-span-2 pt-3">
                <dt className={LABEL}>Full payout if</dt>{" "}
                <dd className="mt-1.5 text-ink-2">{symbol} ends {direction} <strong className="font-mono font-medium text-ink">{formatPrice(capPrice(current.terms), quoteDecimals)}</strong></dd>
              </div>
            )}
          </dl>
          {!(series && current) && <p role="status" className="mt-3 text-sm text-ink-2">{empty}</p>}
        </div>

        <div className={`mt-3 border-t border-rule pt-3.5 ${stickyAction ? "bottom-0 z-10 -mx-4 bg-page/95 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:mx-0 sm:px-0 [@media(min-height:44rem)]:sticky" : ""}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
            <span>
              Max loss <strong className="text-[0.8125rem] font-medium tracking-normal text-ink">{valid ? formatUsd(current.cost, quoteDecimals, "up").replace(/\.00$/, "") : "—"}</strong>
            </span>
            <span>
              Sell back now <strong className="text-[0.8125rem] font-medium tracking-normal text-ink">{valid ? formatUsd(current.cashOut, quoteDecimals) : "—"}</strong>
            </span>
          </div>
          <div className="mt-3 w-full *:w-full">{action}</div>
        </div>
      </section>
    </div>
  );
}
