import type { PricePoint } from "../api/market.ts";

interface Scale {
  (value: number): number;
  invert(px: number): number;
}

const NICE = [1, 2, 2.5, 5, 10];
const MIN_HALF_RANGE = 0.03;
const SIGMAS_SHOWN = 2.1;
const HEADROOM = 1.15;

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const scale = (value: number) => r0 + (value - d0) * k;
  scale.invert = (px: number) => (k === 0 ? d0 : d0 + (px - r0) / k);
  return scale;
}

export function priceDomain(spot: number, moveSigma: number, prices: number[]): [number, number] {
  let half = spot * Math.max(MIN_HALF_RANGE, moveSigma * SIGMAS_SHOWN);
  for (const price of prices) half = Math.max(half, Math.abs(price - spot) * HEADROOM);
  return [Math.max(spot - half, 0), spot + half];
}

export function chartDomain(spot: number, moveSigma: number, history: PricePoint[], focus: number[], strike: number): [number, number] {
  return priceDomain(spot, moveSigma, [...history.map(([, price]) => price), ...focus, strike]);
}

export function barScale(reference: bigint, payout: bigint): bigint {
  return reference > payout ? reference : payout;
}

export function ticks([low, high]: [number, number], maxTicks: number): number[] {
  const span = high - low;
  if (!(span > 0) || maxTicks < 1) return [];
  const raw = span / maxTicks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = (NICE.find((m) => m * power >= raw) ?? 10) * power;
  const at = (i: number) => Number((i * step).toPrecision(12));
  const out: number[] = [];
  for (let i = Math.floor(low / step); at(i) <= high; i++) if (at(i) >= low) out.push(at(i));
  return out;
}

export function cone(spot: number, vol: number, years: number, steps: number): { at: number; low: number; high: number }[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const move = vol * Math.sqrt(Math.max(years, 0) * (i / steps));
    return { at: i / steps, low: spot * Math.exp(-move), high: spot * Math.exp(move) };
  });
}

export function nearestIndex(value: number, sorted: number[]): number {
  let best = -1;
  for (let i = 0; i < sorted.length; i++) if (best < 0 || Math.abs((sorted[i] ?? 0) - value) < Math.abs((sorted[best] ?? 0) - value)) best = i;
  return best;
}
