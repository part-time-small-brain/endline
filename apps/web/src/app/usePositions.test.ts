import { describe, expect, it } from "vitest";
import { holding, positions } from "./usePositions.ts";

const NOW = 1_800_000_000;
const series = {
  id: "BTC-X",
  underlying: "BTC",
  kind: "call" as const,
  strike: "81000000000",
  width: "2000000000",
  expiry: NOW + 86_400,
  underlying_decimals: 8,
  option_asset: "opt:BTC-X",
  quotable: true,
};
const data = (marks: Record<string, { series_id: string; ask: string; bid?: string; vol: number }> | undefined) => ({
  listing: { quote_asset: "usdc", quote_decimals: 6, series: [series] },
  balances: { "opt:BTC-X": 25_000_000n },
  fills: [],
  tapBalances: undefined,
  tapFills: undefined,
  settlements: {},
  marks,
  timing: { write_cutoff_sec: 1_800 },
  optionAsset: (id: string) => `opt:${id}`,
});
const valueOf = (marks: Parameters<typeof data>[0]) => positions(data(marks), NOW)?.[0]?.valueNow;

describe("positions", () => {
  it("value an active position at the market maker's bid, $0 without a bid, and unknown without a mark or while marks fail", () => {
    expect(valueOf({ "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", vol: 0.4 } })).toBe(95_000_000n);
    expect(valueOf({ "BTC-X": { series_id: "BTC-X", ask: "400000000", vol: 0.4 } })).toBe(0n);
    expect(valueOf({})).toBeUndefined();
    expect(valueOf(undefined)).toBeUndefined();
  });

  it("keeps the final payout but waits until finalAt + 60 to collect", () => {
    const finalAt = series.expiry + 3_600;
    const settled = {
      ...data(undefined),
      settlements: { [`BTC:${series.expiry}`]: { price: 83_000_000_000n, finalAt } },
    };
    expect(positions(settled, finalAt - 1)?.[0]).toMatchObject({ status: "settling", payout: 0n });
    for (const now of [finalAt, finalAt + 59]) {
      expect(positions(settled, now)?.[0]).toMatchObject({ status: "settling", payout: 500_000_000n });
    }
    expect(positions(settled, finalAt + 60)?.[0]).toMatchObject({ status: "collect", payout: 500_000_000n });
  });

  it("sorts both balances together, so a Tap payout ready to collect comes before a main bet that ended at $0", () => {
    const finalAt = series.expiry + 3_600;
    const put = { ...series, id: "BTC-P", kind: "put" as const, option_asset: "opt:BTC-P" };
    const both = {
      ...data(undefined),
      listing: { quote_asset: "usdc", quote_decimals: 6, series: [series, put] },
      balances: { "opt:BTC-P": 25_000_000n },
      tapBalances: { "opt:BTC-X": 25_000_000n },
      tapFills: [],
      settlements: { [`BTC:${series.expiry}`]: { price: 83_000_000_000n, finalAt } },
    };
    expect(positions(both, finalAt + 60)?.map((v) => [v.series.id, v.status, v.tap])).toEqual([
      ["BTC-X", "collect", true],
      ["BTC-P", "expired", false],
    ]);
  });

  it("marks zero payouts expired and collected positions paid at finalAt without waiting", () => {
    const finalAt = series.expiry + 3_600;
    const settled = {
      ...data(undefined),
      settlements: { [`BTC:${series.expiry}`]: { price: 81_000_000_000n, finalAt } },
    };
    expect(positions(settled, finalAt)?.[0]).toMatchObject({ status: "expired", payout: 0n });
    const paid = {
      ...settled,
      balances: { "opt:BTC-X": 0n },
      settlements: { [`BTC:${series.expiry}`]: { price: 83_000_000_000n, finalAt } },
      fills: [{ quote_id: "buy", series_id: series.id, side: "buy" as const, account_id: "user.near", size: "25000000", premium: "1000000", tx_hash: "tx", at_ms: NOW * 1_000 }],
    };
    expect(positions(paid, finalAt)?.[0]).toMatchObject({ status: "paid", payout: 500_000_000n });
  });

  it("sums what a cell is worth across both balances, and counts P&L only from bets with a price and a cost", () => {
    const marks = { "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", vol: 0.4 } };
    const fill = (side: "buy" | "sell", size: string, premium: string) => ({ quote_id: side, series_id: series.id, side, account_id: "user.near", size, premium, tx_hash: "tx", at_ms: NOW * 1_000 });
    const both = (fills: ReturnType<typeof fill>[], tapFills: ReturnType<typeof fill>[], withMarks: Parameters<typeof data>[0] = marks) => holding(positions({ ...data(withMarks), fills, tapBalances: { "opt:BTC-X": 2_000_000n }, tapFills }, NOW) ?? [], series.id);
    expect(both([fill("buy", "25000000", "80000000")], [])).toEqual({ value: 102_600_000n, pnl: 15_000_000n, paid: 80_000_000n });
    expect(both([fill("buy", "30000000", "90000000"), fill("sell", "5000000", "19000000")], [fill("buy", "2000000", "5000000")])).toEqual({ value: 102_600_000n, pnl: 26_600_000n, paid: 95_000_000n });
    expect(both([fill("buy", "25000000", "80000000")], [], {})).toEqual({ value: undefined, pnl: undefined, paid: 0n });
    expect(holding([], series.id)).toEqual({ value: undefined, pnl: undefined, paid: 0n });
  });

  it("stop valuing at the bid once the series is close-only", () => {
    const marks = { "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", vol: 0.4 } };
    expect(positions(data(marks), series.expiry - 1_800)?.[0]).toMatchObject({ status: "closed", valueNow: undefined });
  });
});
