import { describe, expect, it } from "vitest";
import { collectBatches, collectTurn, minRelayedPayout } from "./collect.ts";

const USD = 1_000_000n;
const views = (cents: number[]) => cents.map((c, id) => ({ id, payout: (BigInt(c) * USD) / 100n }));

describe("collectBatches", () => {
  it("relays batches of up to 10 that reach $1, largest payouts first, and leaves the rest for a wallet", () => {
    const batches = collectBatches(views([30, 500, 20, 100, 100, 100, 100, 100, 100, 100, 100]), minRelayedPayout(6));
    expect(batches.map((b) => [b.views.map((v) => v.id), b.relayed])).toEqual([
      [[1, 3, 4, 5, 6, 7, 8, 9, 10, 0], true],
      [[2], false],
    ]);
  });

  it("relays exactly $1 and not a cent less", () => {
    expect(collectBatches(views([60, 40]), minRelayedPayout(6))[0]?.relayed).toBe(true);
    expect(collectBatches(views([60, 39]), minRelayedPayout(6))[0]?.relayed).toBe(false);
  });
});

describe("collectTurn", () => {
  it("collects the main balance first and the Tap balance on the next click, never both at once", () => {
    const main = { id: "main", tap: false };
    const tap = { id: "tap", tap: true };
    expect(collectTurn([tap, main, tap])).toEqual([main]);
    expect(collectTurn([tap, tap])).toEqual([tap, tap]);
    expect(collectTurn([])).toEqual([]);
  });
});
