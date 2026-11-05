import type { Series } from "./protocol.ts";
import type { OptionKind } from "./series.ts";

export interface Terms {
  kind: OptionKind;
  strike: bigint;
  width: bigint;
  unit: bigint;
}

export function termsOf(series: Pick<Series, "kind" | "strike" | "width" | "underlying_decimals">): Terms {
  return {
    kind: series.kind,
    strike: BigInt(series.strike),
    width: BigInt(series.width),
    unit: 10n ** BigInt(series.underlying_decimals),
  };
}

export function capPrice(t: Pick<Terms, "kind" | "strike" | "width">): bigint {
  return t.kind === "call" ? t.strike + t.width : t.strike - t.width;
}

export function maxPayout(t: Terms, amount: bigint): bigint {
  return longPayout(t, amount, capPrice(t));
}

export function longPayout(t: Terms, amount: bigint, settlement: bigint): bigint {
  const move = t.kind === "call" ? settlement - t.strike : t.strike - settlement;
  const intrinsic = move <= 0n ? 0n : move < t.width ? move : t.width;
  return (amount * intrinsic) / t.unit;
}
