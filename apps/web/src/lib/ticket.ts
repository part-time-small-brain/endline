import { capPrice, type Mark, maxPayout, type Series, type Terms, termsOf } from "@endline/sdk";
import { formatUsd } from "./money.ts";
import { breakeven, costOf, sizeForBudget } from "./payoff.ts";

export interface Ticket {
  terms: Terms;
  size: bigint;
  cost: bigint;
  maxCost: bigint;
  capped: boolean;
  breakeven: bigint | null;
  cashOut: bigint;
}

export function ticket(series: Series, budget: bigint, mark: Mark | undefined): Ticket {
  const terms = termsOf(series);
  const ask = BigInt(mark?.ask ?? 0);
  const bid = BigInt(mark?.bid ?? 0);
  const most = BigInt(mark?.max_size ?? 0);
  const wanted = ask < terms.width ? sizeForBudget(budget, ask, terms.unit) : 0n;
  const size = wanted < most ? wanted : most;
  const cost = costOf(size, ask, terms.unit);
  return { terms, size, cost, maxCost: costOf(most, ask, terms.unit), capped: wanted > most, breakeven: breakeven(terms, size, cost), cashOut: (size * bid) / terms.unit };
}

const PRESETS = [10, 25, 50, 100];
const SMALL = [1, 2, 5];
const BELOW_MAX = 3;

export function maxBinds(max: bigint | undefined, unit: bigint): max is bigint {
  return max !== undefined && max > 0n && max <= BigInt(PRESETS.at(-1) ?? 0) * unit;
}

export function amountChoices(max: bigint | undefined, unit: bigint): number[] {
  return maxBinds(max, unit) ? [...SMALL, ...PRESETS].filter((dollars) => BigInt(dollars) * unit < max).slice(-BELOW_MAX) : PRESETS;
}

export interface GoodCase {
  price: bigint;
  payout: bigint;
}

export function goodCase(t: Ticket): GoodCase | null {
  const payout = maxPayout(t.terms, t.size);
  return payout > t.cost ? { price: capPrice(t.terms), payout } : null;
}

export function payoutMultiple(t: Ticket): bigint | undefined {
  return t.size > 0n && t.cost > 0n ? (maxPayout(t.terms, t.size) * 10n) / t.cost : undefined;
}

export function capNote(t: Ticket, budget: bigint, atMax: boolean, quoteDecimals: number): string | undefined {
  const usd = (value: bigint, rounding: "up" | "down") => formatUsd(value, quoteDecimals, rounding).replace(/\.00$/, "");
  const cost = usd(t.cost, "up");
  return t.capped && !atMax && cost !== usd(budget, "down") ? `One trade pays out at most ${usd(maxPayout(t.terms, t.size), "down")}, so this costs ${cost}.` : undefined;
}
