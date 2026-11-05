import { describe, expect, it } from "vitest";
import { callMultiple, callPoints, roundOf } from "./calls.ts";
import { termsOf } from "./math.ts";

const USD = 1_000_000n;
const call = termsOf({ kind: "call", strike: (81_000n * USD).toString(), width: (2_000n * USD).toString(), underlying_decimals: 8 });
const put = termsOf({ kind: "put", strike: (81_000n * USD).toString(), width: (2_000n * USD).toString(), underlying_decimals: 8 });

describe("callPoints", () => {
  it("pays the stake back times what the cell paid at its price, net of the stake", () => {
    expect(callPoints(call, 400n * USD, 83_000n * USD)).toBe(400);
    expect(callPoints(call, 400n * USD, 90_000n * USD)).toBe(400);
    expect(callPoints(put, 400n * USD, 79_500n * USD)).toBe(275);
  });

  it("loses the stake at or short of the price to beat, and an in-the-money call that returns less than its stake still loses points", () => {
    expect(callPoints(call, 400n * USD, 81_000n * USD)).toBe(-100);
    expect(callPoints(put, 400n * USD, 82_000n * USD)).toBe(-100);
    expect(callPoints(call, 400n * USD, 81_200n * USD)).toBe(-50);
    expect(callPoints(call, 400n * USD, 81_399n * USD)).toBe(-1);
  });

  it("caps a win at 25 times the stake, so a near-free cell can't top the board on one lucky call", () => {
    expect(callPoints(call, 18_721n, 83_000n * USD)).toBe(2_400);
    expect(callPoints(call, 80n * USD, 83_000n * USD)).toBe(2_400);
    expect(callPoints(call, 81n * USD, 83_000n * USD)).toBe(2_369);
  });
});

describe("callMultiple", () => {
  it("is the gross multiple in tenths at the call's ask, capped where the points are", () => {
    expect(callMultiple(call, 400n * USD)).toBe(50n);
    expect(callMultiple(call, 18_721n)).toBe(250n);
  });
});

describe("roundOf", () => {
  it("is the UTC date the market ends on, so BTC and ETH share a round", () => {
    expect(roundOf(Date.UTC(2026, 10, 5, 8) / 1000)).toBe("2026-11-05");
    expect(roundOf(Date.UTC(2026, 10, 5, 23, 59) / 1000)).toBe("2026-11-05");
  });
});
