import { describe, expect, it } from "vitest";
import { holding, positions, tooSmallToSell } from "./usePositions.ts";

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
const data = (marks: Record<string, { series_id: string; ask: string; bid?: string; max_size: string; vol: number }> | undefined) => ({
  listing: { quote_asset: "usdc", quote_decimals: 6, series: [series] },
  balances: { "opt:BTC-X": 25_000_000n },
  fills: [],
  settlements: {},
  marks,
  timing: { write_cutoff_sec: 1_800 },
  optionAsset: (id: string) => `opt:${id}`,
});
const valueOf = (marks: Parameters<typeof data>[0]) => positions(data(marks), NOW)?.[0]?.valueNow;

describe("positions", () => {
  it("can't sell back a position worth under $1, the least a market maker quotes", () => {
    const at = (bid: string | undefined) => positions(data(bid === undefined ? {} : { "BTC-X": { series_id: "BTC-X", ask: "400000000", bid, max_size: "100000000", vol: 0.4 } }), NOW)?.[0];
    expect(tooSmallToSell(at("3990000")!, 6)).toBe(true);
    expect(tooSmallToSell(at("4000000")!, 6)).toBe(false);
    expect(tooSmallToSell(at(undefined)!, 6)).toBe(false);
  });

  it("value an active position at the market maker's bid, $0 without a bid, and unknown without a mark or while marks fail", () => {
    expect(valueOf({ "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", max_size: "100000000", vol: 0.4 } })).toBe(95_000_000n);
    expect(valueOf({ "BTC-X": { series_id: "BTC-X", ask: "400000000", max_size: "100000000", vol: 0.4 } })).toBe(0n);
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

  it("values a held cell at the bid, counts what was sold back in its P&L, and shows P&L only with a price and a cost", () => {
    const marks = { "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", max_size: "100000000", vol: 0.4 } };
    const fill = (side: "buy" | "sell", size: string, premium: string) => ({ quote_id: side, series_id: series.id, side, account_id: "user.near", size, premium, tx_hash: "tx", at_ms: NOW * 1_000 });
    const cell = (fills: ReturnType<typeof fill>[], withMarks: Parameters<typeof data>[0] = marks) => holding(positions({ ...data(withMarks), fills }, NOW) ?? [], series.id);
    expect(cell([])).toEqual({ value: 95_000_000n, pnl: undefined, change: undefined });
    expect(cell([fill("buy", "30000000", "80000000"), fill("sell", "5000000", "20000000")])).toEqual({ value: 95_000_000n, pnl: 35_000_000n, change: 0.4375 });
    expect(cell([fill("buy", "25000000", "80000000")], {})).toEqual({ value: undefined, pnl: undefined, change: undefined });
    expect(holding([], series.id)).toEqual({ value: undefined, pnl: undefined, change: undefined });
  });

  it("stop valuing at the bid once the series is close-only", () => {
    const marks = { "BTC-X": { series_id: "BTC-X", ask: "400000000", bid: "380000000", max_size: "100000000", vol: 0.4 } };
    expect(positions(data(marks), series.expiry - 1_800)?.[0]).toMatchObject({ status: "closed", valueNow: undefined });
  });
});
