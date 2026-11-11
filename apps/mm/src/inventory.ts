import type { Diff } from "@endline/sdk";

export const CHAIN_LAG_MS = 3_000;

interface Reservation {
  diff: Diff;
  releaseAfter: number;
}

export class Inventory {
  private balances = new Map<string, bigint>();
  private balancesFetchedAt = -Infinity;
  private readonly reservations = new Map<string, Reservation>();

  setBalances(balances: Map<string, bigint>, fetchStartedAt: number): void {
    if (fetchStartedAt < this.balancesFetchedAt) return;
    this.balancesFetchedAt = fetchStartedAt;
    this.balances = new Map(balances);
    for (const [id, r] of this.reservations) {
      if (fetchStartedAt > r.releaseAfter + CHAIN_LAG_MS) this.reservations.delete(id);
    }
  }

  fetchedAt(): number {
    return this.balancesFetchedAt;
  }

  confirmed(): Map<string, bigint> {
    return new Map(this.balances);
  }

  has(quoteId: string): boolean {
    return this.reservations.has(quoteId);
  }

  reserve(quoteId: string, diff: Diff, deadlineMs: number): void {
    if (this.reservations.has(quoteId)) throw new Error(`quote ${quoteId} already reserved`);
    this.reservations.set(quoteId, { diff, releaseAfter: deadlineMs });
  }

  release(quoteId: string): void {
    this.reservations.delete(quoteId);
  }

  available(asset: string): bigint {
    let amount = this.balances.get(asset) ?? 0n;
    for (const { diff } of this.reservations.values()) {
      const delta = diff[asset] ?? 0n;
      if (delta < 0n) amount += delta;
    }
    return amount;
  }

  pending(): Diff[] {
    return [...this.reservations.values()].map(({ diff }) => diff);
  }
}
