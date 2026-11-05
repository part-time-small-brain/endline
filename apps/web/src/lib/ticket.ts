import { capPrice, type Mark, maxPayout, type Series, type Terms, termsOf } from "@endline/sdk";
import { breakeven, costOf, sizeForBudget } from "./payoff.ts";

export interface Ticket {
  terms: Terms;
  size: bigint;
  cost: bigint;
  breakeven: bigint | null;
  cashOut: bigint;
}

export function ticket(series: Series, budget: bigint, mark: Mark | undefined): Ticket {
  const terms = termsOf(series);
  const ask = BigInt(mark?.ask ?? 0);
  const bid = BigInt(mark?.bid ?? 0);
  const size = mark && ask < terms.width ? sizeForBudget(budget, ask, terms.unit) : 0n;
  const cost = costOf(size, ask, terms.unit);
  return { terms, size, cost, breakeven: breakeven(terms, size, cost), cashOut: (size * bid) / terms.unit };
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
