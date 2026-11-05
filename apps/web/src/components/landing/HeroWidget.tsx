import { longPayout, type OptionKind, type Series } from "@endline/sdk";
import { CurrencyBtc, CurrencyEth } from "@phosphor-icons/react";
import { type Ref, useState } from "react";
import { Link } from "../../app/router.tsx";
import { formatChance, formatPrice, formatUsd, toNumber, toUnits } from "../../lib/money.ts";
import { chance } from "../../lib/odds.ts";
import { PATHS } from "../../lib/route.ts";
import { presets } from "../../lib/targets.ts";
import { type Ticket, ticket } from "../../lib/ticket.ts";
import { countdown, formatClock, formatUtc } from "../../lib/time.ts";
import { Chips, pickWithArrows } from "../Chips.tsx";
import { SideGlyph } from "../Glyphs.tsx";
import { Money } from "../Money.tsx";
import { HorizonChart } from "../trade/HorizonChart.tsx";
import { balancedOf, type DemoMarket } from "./useDemoMarket.ts";

interface Props {
  market: DemoMarket | undefined;
  nowSec: number;
  kind: OptionKind;
  onKind: (kind: OptionKind) => void;
  onLine: (y: number) => void;
  plotRef: Ref<HTMLDivElement>;
}

export const PLOT_HEIGHT = 280;
const PAY_USD = [10, 25, 50, 100];
const REFERENCE_USD = 50;
const KINDS = ["call", "put"] as const;
const ICONS: Record<string, typeof CurrencyBtc> = { BTC: CurrencyBtc, ETH: CurrencyEth };

const strikeOf = (s: Series) => BigInt(s.strike);

export function HeroWidget({ market, nowSec, kind, onKind, onLine, plotRef }: Props) {
  const [symbolChoice, setSymbol] = useState<string>();
  const [seriesChoice, setSeries] = useState<string>();
  const [payUsd, setPay] = useState(25);

  const asset = market?.assets.find((a) => a.symbol === symbolChoice) ?? market?.assets[0];
  const qd = market?.quoteDecimals ?? 6;
  const unit = 10n ** BigInt(qd);
  const usdOf = (s: Series) => toNumber(strikeOf(s), qd);
  const strikes = asset?.strikes[kind] ?? [];
  const balanced = asset && balancedOf(asset, kind, qd);
  const series = strikes.find((s) => s.id === seriesChoice) ?? balanced;
  const focus = asset ? presets(strikes.map(strikeOf), kind, toUnits(asset.spot, qd)).flatMap((p) => strikes[p.index] ?? []).map(usdOf) : [];
  const pick = (next: () => void) => {
    next();
    setSeries(undefined);
  };

  if (!market || !asset || !series || !balanced) {
    return (
      <div aria-busy="true" aria-label="Loading prices" className="overflow-hidden rounded-3xl bg-surface shadow-[0_24px_64px_rgb(14_20_32/0.14)]">
        <div className="flex h-[68px] items-center gap-4 px-4">
          <span className="h-10 w-40 animate-pulse rounded-xl bg-well" />
          <span className="h-7 w-28 animate-pulse rounded-lg bg-well" />
        </div>
        <div ref={plotRef} style={{ height: PLOT_HEIGHT }} className="animate-pulse bg-well/50" />
        <div className="grid gap-3 p-4">
          <span className="h-14 animate-pulse rounded-2xl bg-well" />
          <span className="h-14 animate-pulse rounded-xl bg-well" />
          <span className="h-14 animate-pulse rounded-2xl bg-well" />
        </div>
      </div>
    );
  }

  const price = (s: Series, usd: number) => ticket(s, BigInt(usd) * unit, asset.marks[s.id]);
  const current = price(series, payUsd);
  const reference = price(balanced, REFERENCE_USD);
  const payoutAt = (t: Ticket, end: number) => longPayout(t.terms, t.size, toUnits(end, qd));
  const up = kind === "call";

  return (
    <div className="overflow-hidden rounded-3xl bg-surface shadow-[0_24px_64px_rgb(14_20_32/0.14),0_0_0_1px_rgb(14_20_32/0.04)]">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 sm:gap-4">
        <div role="radiogroup" aria-label="Asset" className="flex gap-1 rounded-xl bg-track p-1" onKeyDown={pickWithArrows}>
          {market.assets.map(({ symbol }) => {
            const Icon = ICONS[symbol];
            const selected = symbol === asset.symbol;
            return (
              <button
                key={symbol}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => pick(() => setSymbol(symbol))}
                className={`flex h-8 items-center gap-2 rounded-lg py-1 pr-3 pl-1 text-sm font-semibold transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] ${selected ? "bg-paper" : "text-ink-2 hover:text-ink"}`}
              >
                <span className="grid size-6 place-items-center rounded-full bg-ink text-on-ink" aria-hidden="true">
                  {Icon ? <Icon size={16} weight="bold" /> : symbol.slice(0, 1)}
                </span>
                {symbol}
              </button>
            );
          })}
        </div>
        <p className="flex items-baseline gap-1.5 font-display text-2xl font-semibold">
          <Money value={toUnits(asset.spot, qd)} decimals={qd} />
        </p>
        <p className="ml-auto hidden text-right text-xs text-ink-2 sm:block">
          <b className="block text-base font-semibold text-ink">{countdown(asset.expiry - nowSec)}</b>
          Ends {formatClock(asset.expiry)} <span className="opacity-60">{formatUtc(asset.expiry)}</span>
        </p>
      </div>

      <div ref={plotRef} style={{ height: PLOT_HEIGHT }}>
        <HorizonChart
          symbol={asset.symbol}
          kind={kind}
          history={asset.history}
          spot={asset.spot}
          vol={asset.vol}
          nowSec={nowSec}
          expiry={asset.expiry}
          strikes={strikes.map(usdOf)}
          strikeIndex={strikes.indexOf(series)}
          focus={focus}
          breakeven={current.breakeven === null ? null : toNumber(current.breakeven, qd)}
          quoteDecimals={qd}
          payout={(end) => payoutAt(current, end)}
          reference={(end) => payoutAt(reference, end)}
          onStrike={(index) => setSeries(strikes[index]?.id)}
          onLine={onLine}
        />
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2" onKeyDown={pickWithArrows}>
          {KINDS.map((k) => {
            const selected = k === kind;
            const shown = selected ? series : balancedOf(asset, k, qd);
            const odds = shown && formatChance(chance(shown, asset.spot, asset.marks[shown.id]?.vol ?? 0, nowSec, qd));
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => pick(() => onKind(k))}
                className={`flex h-14 items-center gap-2 rounded-2xl px-4 text-left transition-[transform,background-color,color] duration-200 ease-out active:scale-[0.98] ${
                  selected ? (k === "call" ? "bg-up text-on-up" : "bg-down text-on-down") : `bg-well hover:bg-well-hover ${k === "call" ? "text-up-ink" : "text-down-ink"}`
                }`}
              >
                <SideGlyph kind={k} size={20} />
                <span className="font-display text-xl font-semibold">{k === "call" ? "Up" : "Down"}</span>
                {odds !== undefined && (
                  <span className={`ml-auto text-sm ${selected ? "" : "text-ink-2"}`}>
                    {odds}
                    <span className="sr-only sm:not-sr-only"> chance</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <Chips
          label="You pay"
          columns="grid grid-cols-4 *:px-1 sm:*:px-3"
          value={String(payUsd)}
          onChange={(v) => setPay(Number(v))}
          options={PAY_USD.map((usd) => ({ value: String(usd), label: <span className="font-display text-lg">${usd}</span> }))}
        />
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Max loss" value={formatUsd(current.cost, qd, "up")} />
          <Stat label="Breakeven" value={current.breakeven === null ? "None" : formatPrice(current.breakeven, qd)} />
        </dl>
        <Link
          href={`${PATHS.trade}?${new URLSearchParams({ series: series.id, pay: String(payUsd) })}`}
          className="inline-flex h-14 items-center justify-center rounded-2xl bg-side font-semibold text-on-side transition-[transform,filter] duration-150 ease-out hover:brightness-105 active:scale-[0.98]"
        >
          Try {asset.symbol} {up ? "Up" : "Down"} for ${payUsd}
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between rounded-xl bg-well px-3 py-2">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
