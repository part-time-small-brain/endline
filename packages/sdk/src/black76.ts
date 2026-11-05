import type { OptionKind } from "./series.ts";

interface Greeks {
  price: number;
  delta: number;
  vega: number;
  callDelta: number;
}

export const YEAR_MS = 365 * 86_400_000;

function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -z * z - 1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const value = t * Math.exp(poly);
  return x >= 0 ? value : 2 - value;
}

function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

export function black76(kind: OptionKind, forward: number, strike: number, vol: number, years: number): Greeks {
  if (!(forward > 0 && strike > 0 && vol > 0 && years > 0)) throw new Error("black76 needs positive inputs");
  const stdDev = vol * Math.sqrt(years);
  const d1 = (Math.log(forward / strike) + (stdDev * stdDev) / 2) / stdDev;
  const d2 = d1 - stdDev;
  const callDelta = normCdf(d1);
  const vega = (forward * Math.sqrt(years) * Math.exp((-d1 * d1) / 2)) / Math.sqrt(2 * Math.PI) / 100;
  if (kind === "call") return { price: forward * callDelta - strike * normCdf(d2), delta: callDelta, vega, callDelta };
  return { price: strike * normCdf(-d2) - forward * normCdf(-d1), delta: callDelta - 1, vega, callDelta };
}

export function capped(kind: OptionKind, forward: number, strike: number, width: number, vol: number, capVol: number, years: number): { price: number; delta: number; vega: number } {
  const near = black76(kind, forward, strike, vol, years);
  const far = black76(kind, forward, kind === "call" ? strike + width : strike - width, capVol, years);
  return { price: near.price - far.price, delta: near.delta - far.delta, vega: near.vega - far.vega };
}
