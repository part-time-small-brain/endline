import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mark, SECONDS_PER_DAY, type Series } from "@endline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Calls } from "./calls.ts";
import { Sessions } from "./session.ts";
import { fakeChain, httpStatus, INTENTS, session } from "./test-fakes.ts";

const USD = 1_000_000n;
const E = Date.UTC(2026, 10, 5, 8) / 1000;
const NEXT = E + SECONDS_PER_DAY;
const DAYS = Array.from({ length: 9 }, (_, i) => E + i * SECONDS_PER_DAY);

const series = (strike: number, expiry = E): Series => ({
  id: `BTC-${expiry}-${strike}-C`,
  underlying: "BTC",
  kind: "call",
  strike: String(BigInt(strike) * USD),
  width: String(2_000n * USD),
  expiry,
  underlying_decimals: 8,
});
const mark = (s: Series, ask = 400n * USD): Mark => ({ series_id: s.id, ask: ask.toString(), vol: 0.4 });
const at = (sec: number) => vi.setSystemTime(sec * 1000);

function setup(list = DAYS.flatMap((day) => [series(81_000, day), series(82_000, day)]), maxCalls?: number) {
  const fake = fakeChain(list);
  const dir = mkdtempSync(join(tmpdir(), "calls-"));
  const book = { marks: list.map((s) => mark(s)) };
  const open = (path = dir) => new Calls(fake.chain, new Sessions(fake.chain, INTENTS), () => book.marks, path, maxCalls);
  const calls = open();
  const call = (seriesId: string, account = "alice.near", signed = session(account)) => calls.add({ series_id: seriesId, signer: { standard: "nep413", signer_id: account }, session: signed });
  const settle = async (expiry: number, price: number) => {
    fake.settlements.set(`BTC:${expiry}`, { price: String(BigInt(price) * USD), final_at: expiry + 3_900 });
    at(expiry + 3_960);
    await calls.score();
  };
  return { ...fake, calls, call, settle, book, dir, open };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(E - 20 * 3_600);
});
afterEach(() => vi.useRealTimers());

describe("free calls", () => {
  it("records a call at the relay's own price at that moment, never the request's", async () => {
    const t = setup();
    const id = series(81_000).id;
    await expect(t.call(id)).resolves.toMatchObject({ series_id: id, account_id: "alice.near", ask: String(400n * USD), at_ms: (E - 20 * 3_600) * 1000 });
    t.book.marks = [mark(series(81_000), 100n * USD)];
    expect(t.calls.byAccount("alice.near").map((c) => c.ask)).toEqual([String(400n * USD)]);
  });

  it("refuses a bad account, a session that doesn't verify, an unknown or closed series, a repeat, no price and a cell that can't pay more than it costs", async () => {
    const t = setup();
    const id = series(81_000).id;
    expect(await httpStatus(t.call(id, "Not An Account"))).toBe(400);
    expect(await httpStatus(t.call(id, "alice.near", { ...session("alice.near"), signature: "ed25519:bad" } as ReturnType<typeof session>))).toBe(401);
    expect(await httpStatus(t.call(id, "alice.near", session("bob.near")))).toBe(401);
    expect(await httpStatus(t.call("BTC-NOPE"))).toBe(404);
    await t.call(id);
    expect(await httpStatus(t.call(id))).toBe(409);
    t.book.marks = [mark(series(81_000))];
    expect(await httpStatus(t.call(series(82_000).id))).toBe(503);
    t.book.marks = [mark(series(82_000), 2_000n * USD)];
    expect(await httpStatus(t.call(series(82_000).id))).toBe(409);
    at(E - 1_000);
    expect(await httpStatus(t.call(series(82_000).id, "bob.near"))).toBe(409);
  });

  it("takes calls only on the next round, and closes them when the averaging window opens even where trading runs to a 60 s cutoff", async () => {
    const t = setup();
    expect(await httpStatus(t.call(series(81_000, NEXT).id))).toBe(409);
    t.chain.contractConfig = async () => ({ intents_id: INTENTS, quote_asset: "nep141:usdc.test", quote_decimals: 6, timing: { write_cutoff_sec: 60 } });
    at(E - 1_800);
    expect(await httpStatus(t.call(series(81_000).id))).toBe(409);
    await expect(t.call(series(81_000, NEXT).id)).resolves.toMatchObject({ series_id: series(81_000, NEXT).id });
  });

  it("allows 10 calls a round per account, then 429, and stops everyone once the store is full", async () => {
    const strikes = Array.from({ length: 11 }, (_, i) => 75_000 + i * 1_000);
    const t = setup(strikes.map((k) => series(k)), 12);
    for (const k of strikes.slice(0, 10)) await t.call(series(k).id);
    expect(await httpStatus(t.call(series(85_000).id))).toBe(429);
    await t.call(series(85_000).id, "bob.near");
    await t.call(series(84_000).id, "bob.near");
    expect(await httpStatus(t.call(series(83_000).id, "carol.near"))).toBe(503);
  });

  it("scores only once the price has been final for a minute, at each call's own ask, with the gross capped at 25×", async () => {
    const t = setup([series(81_000), series(82_000)]);
    await t.call(series(81_000).id);
    t.book.marks = [mark(series(82_000), 50n * USD)];
    await t.call(series(82_000).id, "bob.near");
    t.settlements.set(`BTC:${E}`, { price: String(83_000n * USD), final_at: E + 3_900 });
    at(E + 3_959);
    await t.calls.score();
    expect(t.calls.byAccount("alice.near")[0]?.result).toBeUndefined();
    at(E + 3_960);
    await t.calls.score();
    expect(t.calls.byAccount("alice.near")[0]?.result).toEqual({ price: String(83_000n * USD), points: 400 });
    expect(t.calls.byAccount("bob.near")[0]?.result?.points).toBe(1_900);
    expect(t.calls.board().today).toEqual([
      { account_id: "bob.near", rank: 1, points: 1_900, wins: 1, streak: 1 },
      { account_id: "alice.near", rank: 2, points: 400, wins: 1, streak: 1 },
    ]);
  });

  it("counts a streak of winning rounds, restarts it after a gap or a losing round, and shows 0 once the latest round is lost", async () => {
    const t = setup();
    const play = async (day: number, price: number) => {
      at(day - 2 * 3_600);
      await t.call(series(81_000, day).id);
      await t.settle(day, price);
      return t.calls.board("alice.near").you?.today?.streak;
    };
    expect(await play(DAYS[0]!, 83_000)).toBe(1);
    expect(await play(DAYS[1]!, 83_000)).toBe(2);
    expect(await play(DAYS[3]!, 83_000)).toBe(1);
    expect(await play(DAYS[4]!, 81_100)).toBe(0);
    expect(await play(DAYS[5]!, 83_000)).toBe(1);
  });

  it("ranks ties by wins then account, sums the last 7 rounds for the week, and finds you beyond the top 20", async () => {
    const t = setup();
    for (const [i, day] of DAYS.slice(0, 8).entries()) {
      at(day - 2 * 3_600);
      await t.call(series(81_000, day).id);
      if (i === 7) {
        for (const n of Array.from({ length: 22 }, (_, j) => j)) await t.call(series(82_000, day).id, `p${String(n).padStart(2, "0")}.near`);
        await t.call(series(81_000, day).id, "zed.near");
      }
      await t.settle(day, i === 7 ? 82_500 : 83_000);
    }
    const board = t.calls.board("p21.near");
    expect(board.round).toBe("2026-11-12");
    expect(board.today.slice(0, 3).map((s) => [s.account_id, s.points])).toEqual([
      ["alice.near", 275],
      ["zed.near", 275],
      ["p00.near", 25],
    ]);
    expect(board.today).toHaveLength(20);
    expect(board.you?.today).toEqual({ account_id: "p21.near", rank: 24, points: 25, wins: 1, streak: 1 });
    expect(board.week[0]).toEqual({ account_id: "alice.near", rank: 1, points: 6 * 400 + 275, wins: 7, streak: 8 });
  });

  it("keeps calls, rounds and streaks across a restart, then drops results a day after their round and voids calls never priced", async () => {
    const t = setup();
    await t.call(series(81_000).id);
    at(NEXT - 2 * 3_600);
    await t.call(series(81_000, NEXT).id);
    await t.settle(NEXT, 83_000);
    const reopened = t.open();
    await reopened.load();
    expect(reopened.board()).toEqual(t.calls.board());
    expect(reopened.byAccount("alice.near")).toEqual(t.calls.byAccount("alice.near"));
    at(NEXT + SECONDS_PER_DAY + 1);
    await reopened.score();
    expect(reopened.byAccount("alice.near").map((c) => c.series_id)).toEqual([series(81_000).id]);
    at(E + 7 * SECONDS_PER_DAY + 1);
    await reopened.score();
    expect(reopened.byAccount("alice.near")).toEqual([]);
    expect(reopened.board().round).toBe("2026-11-06");
  });
});
