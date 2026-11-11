import { YEAR_MS } from "@endline/sdk";
import { type Instrument, type Mark, parseInstrument } from "./deribit.ts";

const MAX_FORWARD_GAP = 0.1;
const MAX_BASIS_A_YEAR = 0.5;

export interface Spot {
  price: number;
  at: number;
}

export interface Point extends Instrument {
  mark: Mark;
}

export function smileOf(marks: Map<string, Mark>): Point[] {
  return [...marks].flatMap(([name, mark]) => {
    const inst = parseInstrument(name);
    return inst ? [{ ...inst, mark }] : [];
  });
}

function nearestExpiry(points: Point[], target: Instrument): Point[] {
  const same = points.filter((p) => p.underlying === target.underlying);
  const distance = (p: Point) => Math.abs(p.expiry - target.expiry);
  const best = Math.min(...same.map(distance));
  return same.filter((p) => distance(p) === best);
}

function interpolate(points: { x: number; vol: number }[], x: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const i = sorted.findIndex((p) => p.x >= x);
  const upper = i < 0 ? sorted.length - 1 : i;
  const lo = sorted[i <= 0 ? upper : i - 1];
  const hi = sorted[upper];
  if (!lo || !hi) throw new Error("empty smile");
  return lo === hi ? lo.vol : lo.vol + ((x - lo.x) / (hi.x - lo.x)) * (hi.vol - lo.vol);
}

export function markFor(points: Point[], spot: Spot | undefined, target: Instrument): Mark | undefined {
  const smile = nearestExpiry(points, target);
  const first = smile[0];
  if (!first || !spot) return undefined;
  const years = Math.max(0, first.expiry * 1000 - spot.at) / YEAR_MS;
  if (Math.abs(Math.log(first.mark.forward / spot.price)) > MAX_FORWARD_GAP + MAX_BASIS_A_YEAR * years) return undefined;
  const sameExpiry = first.expiry === target.expiry;
  const forward = sameExpiry ? first.mark.forward : spot.price;
  const vol = interpolate(
    smile.map((p) => ({ x: Math.log(p.strike / p.mark.forward), vol: p.mark.vol })),
    Math.log(target.strike / forward),
  );
  const marksAt = Math.min(...smile.map((p) => p.mark.at));
  return { vol, forward, at: sameExpiry ? marksAt : Math.min(marksAt, spot.at) };
}
