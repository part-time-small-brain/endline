import { type ListedSeries, TWAP_WINDOW_SEC, twapPoints } from "@endline/sdk";
import type { PricePoint } from "../api/market.ts";
import { winningAt } from "./grid.ts";
import { type SeriesStatus, type SettlementView, seriesStatus } from "./status.ts";

const MINUTES = TWAP_WINDOW_SEC / 60;
const MIN_MINUTES = 25;
const KEEP_SEC = 3 * 3_600;
const TOO_CLOSE_BPS = 10n;

export type Phase = Exclude<SeriesStatus, "active">;
type Verdict = "win" | "lose" | "close";

export interface Closing {
  expiry: number;
  phase: Phase;
  settlement: SettlementView | null;
}

export const PHASE_TITLES: Record<Phase, string> = { close_only: "Final round", awaiting_price: "Ended", proposed: "Ended", final: "Result" };
export const isEstimate = (phase: Phase) => phase === "close_only" || phase === "awaiting_price";

export function averageEstimate(history: PricePoint[], expiry: number, nowMs: number, spot: number): number | undefined {
  const done = twapPoints(history, expiry, nowMs);
  if (nowMs >= expiry * 1000 && done.length < MIN_MINUTES) return undefined;
  const missing = Math.max(MINUTES - done.length, 0);
  return (done.reduce((sum, price) => sum + price, 0) + missing * spot) / (done.length + missing);
}

export function phaseOf(expiry: number, settlement: SettlementView | null, nowSec: number): Phase | undefined {
  if (nowSec >= expiry + KEEP_SEC) return undefined;
  const status = seriesStatus(expiry, TWAP_WINDOW_SEC, settlement, nowSec);
  return status === "active" ? undefined : status;
}

export function closingOf(expiries: number[], staked: number[], settlementOf: (expiry: number) => SettlementView | null, nowSec: number): Closing | undefined {
  for (const expiry of [...expiries].sort((a, b) => a - b)) {
    const settlement = settlementOf(expiry);
    const phase = phaseOf(expiry, settlement, nowSec);
    if (phase === "close_only" || (phase && staked.includes(expiry))) return { expiry, phase, settlement };
  }
  return undefined;
}

export function verdictOf(series: ListedSeries, phase: Phase, price: bigint): Verdict {
  const strike = BigInt(series.strike);
  const gap = price > strike ? price - strike : strike - price;
  if (isEstimate(phase) && gap * 10_000n < strike * TOO_CLOSE_BPS) return "close";
  return winningAt(series, price) ? "win" : "lose";
}

export function callVerdict(series: ListedSeries, phase: Phase, price: bigint, points: number): Verdict {
  if (verdictOf(series, phase, price) === "close") return "close";
  return points > 0 ? "win" : "lose";
}

export function pointsSays(phase: Phase, verdict: Verdict, points: string): string {
  if (verdict === "close") return "too close to call";
  if (phase === "close_only") return `on track for ${points}`;
  if (phase === "awaiting_price") return `looks like ${points}`;
  if (phase === "proposed") return `${points} if the proposed price stands`;
  return points;
}

export function revealSays(phase: Phase, verdict: Verdict, usd: string): string {
  if (verdict === "close") return "too close to call";
  const pays = verdict === "win";
  if (phase === "close_only") return pays ? `on track to pay about ${usd}` : "on track to pay nothing";
  if (phase === "awaiting_price") return pays ? `looks like it pays about ${usd}` : "looks like it pays nothing";
  if (phase === "proposed") return pays ? `pays ${usd} if the proposed price stands` : "pays nothing if the proposed price stands";
  return pays ? `pays ${usd}` : "lost";
}
