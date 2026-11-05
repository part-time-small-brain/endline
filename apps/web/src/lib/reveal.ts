import { type ListedSeries, longPayout, termsOf, TWAP_WINDOW_SEC, twapPoints } from "@endline/sdk";
import type { PricePoint } from "../api/market.ts";
import { type SettlementView, seriesStatus } from "./status.ts";

const MINUTES = TWAP_WINDOW_SEC / 60;
const KEEP_SEC = 3 * 3_600;
const TOO_CLOSE_BPS = 10n;

export type Phase = "final_round" | "ended" | "proposed" | "final";
export type Verdict = "win" | "lose" | "close";

const PHASES = { close_only: "final_round", awaiting_price: "ended", proposed: "proposed", final: "final" } as const;
export const PHASE_TITLES: Record<Phase, string> = { final_round: "Final round", ended: "Ended", proposed: "Ended", final: "Result" };

export function averageEstimate(history: PricePoint[], expiry: number, nowMs: number, spot: number): number {
  const done = twapPoints(history, expiry, nowMs);
  const missing = Math.max(MINUTES - done.length, 0);
  return (done.reduce((sum, price) => sum + price, 0) + missing * spot) / (done.length + missing);
}

export function phaseOf(expiry: number, settlement: SettlementView | null, nowSec: number): Phase | undefined {
  if (nowSec < expiry - TWAP_WINDOW_SEC || nowSec >= expiry + KEEP_SEC) return undefined;
  const status = seriesStatus(expiry, TWAP_WINDOW_SEC, settlement, nowSec);
  return status === "active" ? undefined : PHASES[status];
}

export function verdictAt(series: ListedSeries, price: bigint): Verdict {
  const strike = BigInt(series.strike);
  const gap = price > strike ? price - strike : strike - price;
  if (gap * 10_000n < strike * TOO_CLOSE_BPS) return "close";
  return longPayout(termsOf(series), termsOf(series).unit, price) > 0n ? "win" : "lose";
}

export function closingOf(expiries: number[], staked: (expiry: number) => boolean, settlementOf: (expiry: number) => SettlementView | null, nowSec: number): { expiry: number; phase: Phase } | undefined {
  for (const expiry of [...new Set(expiries)].sort((a, b) => a - b)) {
    const phase = phaseOf(expiry, settlementOf(expiry), nowSec);
    if (phase === "final_round" || (phase && staked(expiry))) return { expiry, phase };
  }
  return undefined;
}

export function verdictOf(series: ListedSeries, phase: Phase, price: bigint): Verdict {
  if (phase === "final_round" || phase === "ended") return verdictAt(series, price);
  return longPayout(termsOf(series), termsOf(series).unit, price) > 0n ? "win" : "lose";
}

export function revealSays(phase: Phase, verdict: Verdict, usd: string): string {
  if (verdict === "close") return "too close to call";
  const win = verdict === "win";
  if (phase === "final_round") return win ? `on track to win about ${usd}` : "on track to lose";
  if (phase === "ended") return win ? `looks like a win, about ${usd}` : "looks like a loss";
  if (phase === "proposed") return win ? `pays ${usd} if the proposed price stands` : "pays nothing if the proposed price stands";
  return win ? `pays ${usd}` : "lost";
}
