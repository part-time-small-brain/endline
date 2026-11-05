import type { Mark } from "@endline/sdk";

export const MARK_TTL_MS = 10_000;

const higher = (a: string | undefined, b: string | undefined) => (a === undefined || (b !== undefined && BigInt(b) > BigInt(a)) ? b : a);

export class Marks {
  private byMm = new Map<string, { receivedAt: number; marks: Mark[] }>();

  set(mmId: string, marks: Mark[], receivedAt: number): void {
    this.byMm.set(mmId, { receivedAt, marks });
  }

  drop(mmId: string): void {
    this.byMm.delete(mmId);
  }

  best(now: number): Mark[] {
    const best = new Map<string, Mark>();
    const fresh = [...this.byMm.values()].filter((m) => now - m.receivedAt <= MARK_TTL_MS);
    for (const mark of fresh.flatMap((m) => m.marks)) {
      const seen = best.get(mark.series_id);
      const cheapest = seen && BigInt(seen.ask) <= BigInt(mark.ask) ? seen : mark;
      best.set(mark.series_id, { series_id: mark.series_id, ask: cheapest.ask, bid: higher(seen?.bid, mark.bid), vol: cheapest.vol });
    }
    return [...best.values()];
  }
}
