import { quotableUntil } from "@endline/sdk";

export type SeriesStatus = "active" | "close_only" | "awaiting_price" | "proposed" | "final";
export type PositionStatus = "active" | "closed" | "settling" | "collect" | "paid" | "expired";

export interface SettlementView {
  price: bigint;
  finalAt: number;
}

export function seriesStatus(expiry: number, cutoffSec: number, settlement: SettlementView | null, nowSec: number): SeriesStatus {
  if (nowSec < quotableUntil(expiry, cutoffSec)) return "active";
  if (nowSec < expiry) return "close_only";
  if (!settlement) return "awaiting_price";
  return nowSec < settlement.finalAt ? "proposed" : "final";
}

export function positionStatus(status: SeriesStatus, payout: bigint, held: bigint, canCollect = true): PositionStatus {
  switch (status) {
    case "active":
      return "active";
    case "close_only":
      return "closed";
    case "awaiting_price":
    case "proposed":
      return "settling";
    case "final":
      if (payout === 0n) return "expired";
      if (held <= 0n) return "paid";
      return canCollect ? "collect" : "settling";
  }
}
