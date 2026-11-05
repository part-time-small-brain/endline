import { type Fill, type ListedSeries, longPayout, termsOf } from "@endline/sdk";
import { useMemo } from "react";
import { type PositionStatus, positionStatus, type SettlementView, seriesStatus } from "../lib/status.ts";
import { type AppData, settlementKey, useData } from "./data.tsx";

export interface PositionView {
  series: ListedSeries;
  held: bigint;
  paid: bigint;
  received: bigint;
  status: PositionStatus;
  settlement: SettlementView | null;
  amount: bigint;
  payout: bigint;
  valueNow: bigint | undefined;
  tap: boolean;
}

const ORDER: PositionStatus[] = ["collect", "active", "closed", "settling", "paid", "expired"];

type PositionData = Pick<AppData, "listing" | "balances" | "fills" | "tapBalances" | "tapFills" | "settlements" | "marks" | "timing" | "optionAsset">;

export function positions(data: PositionData, nowSec: number): PositionView[] | undefined {
  const main = accountPositions(data, data.balances, data.fills, nowSec, false);
  const tap = accountPositions(data, data.tapBalances, data.tapFills, nowSec, true) ?? [];
  return main && [...main, ...tap].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.series.expiry - b.series.expiry);
}

function accountPositions({ listing, settlements, marks, timing, optionAsset }: PositionData, balances: AppData["balances"], fills: AppData["fills"], nowSec: number, tap: boolean): PositionView[] | undefined {
  if (!listing || !balances || !fills || !timing) return undefined;
  return listing.series
    .flatMap((s): PositionView[] => {
      const own = fills.filter((fill) => fill.series_id === s.id);
      const sum = (side: Fill["side"], field: "size" | "premium") =>
        own.filter((fill) => fill.side === side).reduce((total, fill) => total + BigInt(fill[field]), 0n);
      const held = balances[optionAsset(s.id)] ?? 0n;
      const amount = held > 0n ? held : sum("buy", "size") - sum("sell", "size");
      if (amount <= 0n) return [];
      const settlement = settlements[settlementKey(s)] ?? null;
      const status = seriesStatus(s.expiry, timing.write_cutoff_sec, settlement, nowSec);
      const terms = termsOf(s);
      const final = status === "final" ? settlement : null;
      const payout = final ? longPayout(terms, amount, final.price) : 0n;
      const mark = marks?.[s.id];
      const valueNow = status === "active" && mark ? (held * BigInt(mark.bid ?? 0)) / terms.unit : undefined;
      const view = { series: s, held, paid: sum("buy", "premium"), received: sum("sell", "premium"), status: positionStatus(status, payout, held, final !== null && nowSec >= final.finalAt + 60), settlement, amount, payout, valueNow, tap };
      return held > 0n || view.status === "paid" ? [view] : [];
    });
}

export function valueOf(view: PositionView): bigint | undefined {
  return view.valueNow ?? (view.status === "active" || view.status === "settling" || view.status === "closed" ? undefined : view.payout);
}

export function pnlOf(view: PositionView): bigint | undefined {
  const value = valueOf(view);
  return value !== undefined && view.paid > 0n ? value + view.received - view.paid : undefined;
}

export interface Holding {
  value: bigint | undefined;
  pnl: bigint | undefined;
  paid: bigint;
}

export function holding(views: PositionView[], seriesId: string): Holding {
  const own = views.filter((v) => v.series.id === seriesId);
  const sum = (values: (bigint | undefined)[]) => values.reduce<bigint | undefined>((total, v) => (v === undefined ? total : (total ?? 0n) + v), undefined);
  const costed = own.filter((v) => pnlOf(v) !== undefined);
  return { value: sum(own.map(valueOf)), pnl: sum(costed.map(pnlOf)), paid: costed.reduce((total, v) => total + v.paid, 0n) };
}

export function usePositions(nowSec: number): PositionView[] | undefined {
  const { listing, balances, fills, tapBalances, tapFills, settlements, marks, timing, optionAsset } = useData();
  return useMemo(() => positions({ listing, balances, fills, tapBalances, tapFills, settlements, marks, timing, optionAsset }, nowSec), [listing, balances, fills, tapBalances, tapFills, settlements, marks, timing, optionAsset, nowSec]);
}
