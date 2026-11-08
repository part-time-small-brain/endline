import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useApp } from "../../app/context.ts";
import { Link } from "../../app/router.tsx";
import { useTicket } from "../../app/useTicket.ts";
import { formatToken, formatUsd } from "../../lib/money.ts";
import { Button } from "../Button.tsx";
import { LABEL } from "../label.ts";
import { Lite } from "../trade/Lite.tsx";
import { HeroDots } from "./HeroDots.tsx";
import { jump } from "./jump.ts";
import { EASE_DRAWER, EASE_OUT } from "./motion.ts";

const FACTS = [
  ["Final price", "Median of 7 exchanges"],
  ["Funding", "Any chain, one balance"],
  ["Settles on", "NEAR Intents"],
];

const BUTTON = "inline-flex h-14 items-center justify-center rounded-2xl px-6 text-lg font-semibold transition-[transform,opacity,background-color] duration-150 ease-out active:scale-[0.97]";
const PRIMARY = `${BUTTON} bg-ink text-on-ink hover:opacity-90`;

export function Hero({ nowSec }: { nowSec: number }) {
  const { paths } = useApp().config;
  const reduce = useReducedMotion();
  const state = useTicket(nowSec);
  const { data, symbol, up, series, current, budget, unit, quoteDecimals, notice, loading } = state;
  const waiting = (!data.listing && !data.listingError) || (!notice && loading);
  const label = `Try ${symbol} ${up ? "Up" : "Down"} for ${formatUsd(budget, quoteDecimals).replace(/\.00$/, "")}`;
  const action = !series ? (
    <Link href={paths.trade} className={PRIMARY}>
      Open app
    </Link>
  ) : current && current.size > 0n ? (
    <Link href={`${paths.trade}?${new URLSearchParams({ series: series.id, pay: formatToken(budget, quoteDecimals, 2).replaceAll(",", "") })}`} className={PRIMARY}>
      {label}
    </Link>
  ) : (
    <Button size="lg" disabled>
      {budget < unit ? "Enter a valid amount" : label}
    </Button>
  );

  return (
    <section aria-labelledby="hero-title" className="relative overflow-x-clip bg-page">
      <HeroDots still={reduce === true} />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 pt-10 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:items-start lg:gap-12 lg:px-12 lg:pt-16 lg:pb-24">
        <div className="lg:pt-12">
          <Rise>
            <p className="flex items-center gap-2.5 font-mono text-[0.6875rem] font-medium tracking-[0.14em] text-ink-3 uppercase">
              <span aria-hidden="true" className="h-0.5 w-6 bg-[linear-gradient(to_right,var(--up)_50%,var(--down)_50%)]" />
              Bitcoin options
            </p>
          </Rise>
          <h1 id="hero-title" className="mt-6 text-5xl leading-none font-semibold tracking-[-0.035em] xl:text-7xl">
            <span className="block">
              <Word index={0}>Pick</Word> <Word index={1}>a</Word> <Word index={2}>side</Word>
            </span>
            <span className="block">
              <Word index={3}>of</Word>{" "}
              <span className="relative inline-block">
                <m.span
                  aria-hidden="true"
                  className="absolute top-full right-[0.18em] left-0 mt-3 flex h-1.5 origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 1.1, ease: EASE_DRAWER, delay: 0.5 }}
                >
                  <span className="flex-1 bg-up" />
                  <span className="flex-1 bg-down" />
                </m.span>
                <Word index={4}>the</Word> <Word index={5}>line.</Word>
              </span>
            </span>
          </h1>
          <Rise delay={0.3}>
            <p className="mt-12 max-w-[520px] text-base text-ink-2 lg:text-xl">
              Choose whether Bitcoin ends above or below your price. The most you can lose is what you pay.
            </p>
          </Rise>
          <Rise delay={0.42}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={paths.trade} className={PRIMARY}>
                Start trading
              </Link>
              <a href="#how" onClick={jump} className={`${BUTTON} ring-1 ring-ink/20 ring-inset hover:bg-well`}>
                How it works
              </a>
            </div>
          </Rise>
          <Rise delay={0.54}>
            <dl className="mt-10 flex max-w-[520px] flex-wrap gap-x-10 gap-y-4 border-t border-rule pt-4">
              {FACTS.map(([term, detail]) => (
                <div key={term}>
                  <dt className={LABEL}>{term}</dt>
                  <dd className="mt-1.5 text-[0.9375rem]">{detail}</dd>
                </div>
              ))}
            </dl>
          </Rise>
        </div>

        <Rise delay={0.25}>
          {waiting ? (
            <div aria-busy="true" aria-label="Loading prices" className="h-[34rem] animate-pulse rounded-md border border-rule bg-surface" />
          ) : notice ? (
            <p role="status" className="grid h-[34rem] place-items-center rounded-md border border-rule bg-surface px-6 text-center text-lg font-semibold">
              {notice.title}
            </p>
          ) : (
            <Lite state={state} nowSec={nowSec} action={action} />
          )}
        </Rise>
      </div>
    </section>
  );
}

function Word({ index, children }: { index: number; children: ReactNode }) {
  return (
    <m.span
      className="inline-block"
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.08 + index * 0.07 }}
    >
      {children}
    </m.span>
  );
}

function Rise({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <m.div initial={{ opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, ease: EASE_OUT, delay }}>
      {children}
    </m.div>
  );
}
