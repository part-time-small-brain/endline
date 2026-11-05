import { longPayout } from "@near-options/sdk";
import type { ReactNode } from "react";
import { formatChance, formatPrice, formatUsd, toUnits } from "../../lib/money.ts";
import { chance } from "../../lib/odds.ts";
import { ticket } from "../../lib/ticket.ts";
import { SideGlyph } from "../Glyphs.tsx";
import { Reveal } from "./Reveal.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { balancedOf, type DemoAsset } from "./useDemoMarket.ts";

interface Props {
  asset: DemoAsset;
  quoteDecimals: number;
  nowSec: number;
}

const PAID_USD = 30n;
const ENDED_ABOVE = 1.03;

export function HowItWorks({ asset, quoteDecimals: qd, nowSec }: Props) {
  const series = balancedOf(asset, "call", qd);
  if (!series) return null;
  const strike = BigInt(series.strike);
  const bought = ticket(series, PAID_USD * 10n ** BigInt(qd), asset.marks[series.id]);
  const ended = toUnits(Math.round((Number(strike) / 10 ** qd) * ENDED_ABOVE), qd);
  const price = (value: bigint) => formatPrice(value, qd);

  return (
    <section id="how" className="mx-auto max-w-7xl scroll-mt-8 px-4 pt-8 pb-24 lg:px-12 lg:pb-32">
      <SectionHead title="Three steps, one signature" />
      <ol className="relative grid gap-12 before:absolute before:inset-y-0 before:left-[19px] before:w-[2.5px] before:bg-ink lg:grid-cols-[1fr_1.15fr_1fr] lg:gap-8 lg:before:inset-x-0 lg:before:top-[19px] lg:before:bottom-auto lg:before:h-[2.5px] lg:before:w-auto">
        <Step n={1} dot="bg-ink text-on-ink" title="Pick a side" line="Up or Down, and the price to beat.">
          <div className="grid grid-cols-2 gap-2">
            <span className="flex h-14 items-center gap-2 rounded-xl bg-up px-4 font-display text-xl font-semibold text-on-up">
              <SideGlyph kind="call" size={20} />
              Up
            </span>
            <span className="flex h-14 items-center gap-2 rounded-xl bg-well px-4 font-display text-xl font-semibold text-down-ink">
              <SideGlyph kind="put" size={20} />
              Down
            </span>
          </div>
          <Row label="Price to beat" value={price(strike)} />
          <Row label="Chance it pays" value={formatChance(chance(series, asset.spot, asset.marks[series.id]?.vol ?? 0, nowSec, qd))} />
        </Step>
        <Step n={2} dot="bg-well" title="Sign once" line="You pay and get the option in one step, or nothing happens." delay={0.12}>
          <Row label="You give" value={`${formatUsd(bought.cost, qd, "up")} USDC`} />
          <Row label="You get" value={`${asset.symbol} Up ${price(strike)}`} />
          <p className="mt-2 flex h-12 items-center justify-center rounded-xl bg-ink text-sm font-semibold text-on-ink">Sign</p>
        </Step>
        <Step n={3} dot="bg-up text-on-up" title="Get paid" line="If you are right, the payout lands in your balance." delay={0.24}>
          <Row label={`${asset.symbol} ended at`} value={price(ended)} />
          <Row label="You paid" value={formatUsd(bought.cost, qd, "up")} />
          <p className="mt-2 flex h-12 items-center justify-between rounded-xl bg-up px-3 text-sm text-on-up">
            Paid automatically
            <b className="text-lg font-semibold">{formatUsd(longPayout(bought.terms, bought.size, ended), qd)}</b>
          </p>
        </Step>
      </ol>
    </section>
  );
}

interface StepProps {
  n: number;
  dot: string;
  title: string;
  line: string;
  delay?: number;
  children: ReactNode;
}

function Step({ n, dot, title, line, delay = 0, children }: StepProps) {
  return (
    <li>
      <Reveal delay={delay} className="relative pl-14 lg:pl-0">
        <span className={`absolute top-0 left-0 grid size-10 place-items-center rounded-full font-display font-bold shadow-[inset_0_0_0_2.5px_var(--ink)] lg:static ${dot}`}>{n}</span>
        <h3 className="mt-1 text-2xl font-semibold lg:mt-6">{title}</h3>
        <p className="mt-2 text-ink-2">{line}</p>
        <div className="mt-6 rounded-3xl bg-surface p-4">{children}</div>
      </Reveal>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between py-2 text-sm not-first:shadow-[0_-1px_0_var(--rule)]">
      <span>{label}</span>
      <b className="font-semibold">{value}</b>
    </p>
  );
}
