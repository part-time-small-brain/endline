import type { ReactNode } from "react";
import { formatClock, formatUtc } from "../../lib/time.ts";
import { nextDailyEnd } from "./dailyEnd.ts";
import { Reveal } from "./Reveal.tsx";
import { SectionHead } from "./SectionHead.tsx";

const VENUES = [
  ["Coinbase", 81_587.42],
  ["Kraken", 81_590.36],
  ["Bybit", 81_593.08],
  ["Bitstamp", 81_593.52],
  ["Binance", 81_596.72],
  ["OKX", 81_600.56],
  ["Bitfinex", 81_698.2],
] as const;
const MEDIAN = 81_593.52;
const PCT_PER_BP = 3.4;
const MAX_SHIFT_PCT = 46;
const PROPOSED_AFTER_SEC = 300;
const DISPUTE_SEC = 3_600;
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function Safety({ nowSec }: { nowSec: number }) {
  const end = nextDailyEnd(nowSec);
  const steps = [
    { at: end, label: "Market ends" },
    { at: end + PROPOSED_AFTER_SEC, label: "Price proposed" },
    { at: end + PROPOSED_AFTER_SEC + DISPUTE_SEC, label: "Final, paid out" },
  ];

  return (
    <section id="safety" className="mx-auto max-w-7xl px-4 py-24 lg:px-12 lg:pt-32 lg:pb-28">
      <SectionHead title="Who holds the money and who sets the price" />

      <Row title="Fully collateralized" line="Every payout is locked in the contract before you buy.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-well p-4">
            <p className="text-xs text-ink-2">Behind every Up and Down</p>
            <p className="mt-1 font-display text-xl font-semibold">Its whole payout in USDC</p>
          </div>
          <div className="rounded-2xl bg-well p-4">
            <p className="text-xs text-ink-2">Paid out</p>
            <p className="mt-1 font-display text-xl font-semibold">In USDC, to your balance</p>
          </div>
        </div>
      </Row>

      <Row title="Median of 7 exchanges" line="Each one averaged over the last 30 minutes, so one outlier can't move the price.">
        <ul className="flex flex-col gap-0.5 text-sm">
          {VENUES.map(([name, price]) => {
            const shift = Math.min(Math.max((price / MEDIAN - 1) * 1e4 * PCT_PER_BP, -MAX_SHIFT_PCT), MAX_SHIFT_PCT);
            const median = price === MEDIAN;
            const outlier = Math.abs(shift) === MAX_SHIFT_PCT;
            return (
              <li
                key={name}
                className={`grid h-8 grid-cols-[72px_1fr_88px] items-center gap-2 rounded-lg px-2 sm:grid-cols-[88px_1fr_96px_72px] sm:gap-3 ${median ? "bg-up-field" : ""} ${outlier ? "text-ink-3" : ""}`}
              >
                <span>{name}</span>
                <span className="relative h-0.5 bg-rule">
                  <span
                    className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${median ? "size-4 bg-up" : "size-3 bg-paper shadow-[inset_0_0_0_2.5px_var(--ink)]"}`}
                    style={{ left: `${50 + shift}%` }}
                  />
                </span>
                <span className="text-right font-semibold">{cents.format(price)}</span>
                <span className="hidden text-right text-xs sm:block">{median ? "Median" : outlier ? "Outlier" : ""}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-ink-2">BTC, one recorded oracle run</p>
      </Row>

      <Row title="Time to catch a wrong price" line="A monitor checks every proposed price. The owner can override a wrong one before it's final.">
        <ol className="relative grid grid-cols-3 pt-2 before:absolute before:inset-x-2 before:top-[15px] before:h-[2.5px] before:bg-ink after:absolute after:top-3 after:right-2 after:left-1/2 after:h-[9px] after:rounded-full after:bg-up">
          {steps.map(({ at, label }, i) => (
            <li key={label} className={`relative z-10 pt-6 text-sm ${i === 1 ? "text-center" : i === 2 ? "text-right" : ""}`}>
              <span
                className={`absolute top-0 size-4 rounded-full shadow-[inset_0_0_0_2.5px_var(--ink)] ${i === 2 ? "right-0 bg-ink" : "bg-paper"} ${i === 1 ? "left-1/2 -translate-x-1/2" : i === 0 ? "left-0" : ""}`}
              />
              <b className="block font-semibold">{formatClock(at)}</b>
              <span className="text-xs text-ink-2">{label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-ink-2">
          Daily end, {formatUtc(end)}. 1 hour dispute window.
        </p>
      </Row>
    </section>
  );
}

function Row({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <Reveal className="grid items-center gap-6 py-10 not-first-of-type:shadow-[0_-1.5px_0_var(--rule)] lg:grid-cols-2 lg:gap-16 lg:py-12">
      <div>
        <h3 className="text-3xl font-semibold">{title}</h3>
        <p className="mt-3 max-w-[520px] text-lg text-ink-2">{line}</p>
      </div>
      <div className="rounded-3xl bg-surface p-4 lg:p-6">{children}</div>
    </Reveal>
  );
}
