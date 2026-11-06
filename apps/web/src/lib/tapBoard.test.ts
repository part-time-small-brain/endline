import type { Call, ListedSeries } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import type { PositionStatus, SettlementView } from "./status.ts";
import { tapBoard } from "./tapBoard.ts";

const E = 1_800_028_800;
const NEXT = E + 86_400;
const USD = 1_000_000n;

const cell = (strike: number, expiry = E, underlying = "BTC"): ListedSeries => ({
  id: `${underlying}-${expiry}-${strike}-C`,
  underlying,
  kind: "call",
  strike: (BigInt(strike) * USD).toString(),
  width: (2_000n * USD).toString(),
  expiry,
  underlying_decimals: 8,
  option_asset: `nep245:opt.near:${underlying}-${expiry}-${strike}-C`,
  quotable: true,
});
const view = (series: ListedSeries, status: PositionStatus = "active") => ({ series, status });
const called = ({ id, option_asset: _, quotable: __, ...terms }: ListedSeries): Call => ({ series_id: id, account_id: "alice.near", terms, ask: String(400n * USD), at_ms: 0 });

interface Setup {
  listing: ListedSeries[];
  priced?: ListedSeries[];
  views?: ReturnType<typeof view>[];
  calls?: Call[];
  settlement?: SettlementView | null;
}
const board = ({ listing, priced = listing, views = [], calls = [], settlement = null }: Setup, nowSec: number) => tapBoard("BTC", listing, priced, views, calls, () => settlement, nowSec);
const ids = (series: ListedSeries[]) => [...new Set(series.map((s) => s.id))].sort();

const [today80, today81, today99, next80, next81] = [cell(80_000), cell(81_000), cell(99_000), cell(80_000, NEXT), cell(81_000, NEXT)] as [ListedSeries, ListedSeries, ListedSeries, ListedSeries, ListedSeries];
const listing = [today80, today81, today99, next80, next81];

describe("tapBoard", () => {
  it("turns a column into the closing one exactly when its final round starts, tradable or not, and drops its cells on rows nothing else uses", () => {
    expect(board({ listing }, E - 1_801).closing).toBeUndefined();
    expect(ids(board({ listing }, E - 1_801).listed)).toEqual(ids(listing));
    for (const now of [E - 1_800, E - 1]) {
      const b = board({ listing }, now);
      expect(b.closing).toMatchObject({ expiry: E, phase: "close_only" });
      expect(ids(b.listed)).toEqual(ids([today80, today81, next80, next81]));
      expect(b.held.size).toBe(0);
    }
  });

  it("keeps an unstaked closing column only until expiry, and a staked one until 3 h after, whatever its settlement says", () => {
    const later = [next80, next81];
    expect(board({ listing, priced: later }, E).closing).toBeUndefined();
    expect(ids(board({ listing, priced: later }, E).listed)).toEqual(ids(later));
    const staked = { listing, priced: later, views: [view(today99, "settling")] };
    expect(board(staked, E).closing).toMatchObject({ expiry: E, phase: "awaiting_price" });
    expect(board({ ...staked, settlement: { price: 82_000n * USD, finalAt: E + 3_600 } }, E + 3_600).closing?.phase).toBe("final");
    const last = board(staked, E + 10_799);
    expect(last.owned.has(today99.id)).toBe(true);
    expect(last.stakes).toEqual(staked.views);
    expect(ids(last.listed)).toEqual(ids(listing));
    const gone = board(staked, E + 10_800);
    expect(gone.closing).toBeUndefined();
    expect(gone.owned.size).toBe(0);
    expect(ids(gone.listed)).toEqual(ids(later));
  });

  it("shows an active holding nobody quotes any more, but never a finished one outside the closing column", () => {
    const unquoted = cell(90_000, NEXT);
    const b = board({ listing: [...listing, unquoted], priced: [next80], views: [view(unquoted), view(next81, "expired")] }, E - 3_600);
    expect(ids(b.listed)).toEqual(ids([next80, unquoted]));
    expect([...b.held]).toEqual([unquoted.id]);
  });

  it("keeps a called cell while it can still be called, through its final round and its reveal, adding no rows of its own, then forgets it", () => {
    const calls = [called(next81)];
    const early = board({ listing, calls }, E - 3_600);
    expect(early.held.has(next81.id)).toBe(true);
    expect(early.owned.has(next81.id)).toBe(false);
    expect(early.closingCalls).toEqual([]);
    const priced = [next80];
    for (const now of [NEXT - 1_800, NEXT, NEXT + 10_799]) {
      const b = board({ listing, priced, calls }, now);
      expect(b.closing?.expiry).toBe(NEXT);
      expect(b.closingCalls).toEqual(calls);
      expect(ids(b.listed)).toEqual([next81.id]);
    }
    const gone = board({ listing, priced: [], calls }, NEXT + 10_800);
    expect(gone.closing).toBeUndefined();
    expect(gone.listed).toEqual([]);
  });

  it("counts a cell you both hold and called once, as held", () => {
    const b = board({ listing, views: [view(next81)], calls: [called(next81)] }, E - 3_600);
    expect([...b.held]).toEqual([next81.id]);
    expect(b.owned.has(next81.id)).toBe(true);
    expect(b.calledHere.has(next81.id)).toBe(true);
    expect(ids(b.listed)).toEqual(ids(listing));
  });

  it("ignores another asset's holdings, calls and cells", () => {
    const eth = cell(3_000, E, "ETH");
    const b = board({ listing: [...listing, eth], priced: [next80, eth], views: [view(eth, "settling")], calls: [called(eth)] }, E + 60);
    expect(b.closing).toBeUndefined();
    expect(b.calledHere.size).toBe(0);
    expect(b.held.size).toBe(0);
    expect(ids(b.listed)).toEqual([next80.id]);
  });
});
