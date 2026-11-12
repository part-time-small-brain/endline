import type { Fill } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { type Activity, type Deposit, render } from "./activity.ts";
import { SERIES } from "./test-fakes.ts";

const PUT = { ...SERIES, id: "BTC-27NOV26-81000_79000-P", kind: "put" as const, strike: "81000000000", expiry: 1_795_766_400 + 86_400 + 3_600 };
const LISTING = new Map([SERIES, PUT].map((s) => [s.id, s]));
const fill: Fill = { quote_id: "q", series_id: SERIES.id, side: "buy", account_id: "alice.near", size: "500000", premium: "1880000", tx_hash: "9xTx", at_ms: 0 };
const deposit: Deposit = { address: "7PVe", accountId: "alice.near", sent: "1.0 SOL on sol", amountOut: 100_305_978n, deadlineMs: 0 };
const text = (activity: Activity, network: "mainnet" | "testnet" = "mainnet") => render(network, activity, LISTING, 6);

describe("render", () => {
  it("tells a buy from a sell-back, with the full account and the explorer of the network", () => {
    expect(text({ kind: "trade", fill })).toBe("🟢 mainnet · Buy BTC Up $110,000, ends 27 Nov 08:00 UTC\n$1.88 for 0.005 BTC · alice.near · https://nearblocks.io/txns/9xTx");
    expect(text({ kind: "trade", fill: { ...fill, side: "sell", series_id: PUT.id, premium: "1200000" } }, "testnet")).toBe(
      "🟠 testnet · Sell back BTC Down $81,000, ends 28 Nov 09:00 UTC\n$1.20 for 0.005 BTC · alice.near · https://testnet.nearblocks.io/txns/9xTx",
    );
  });

  it("refuses a fill of a series it can't find instead of posting a wrong title", () => {
    expect(() => text({ kind: "trade", fill: { ...fill, series_id: "BTC-1JAN27-1_2-C" } })).toThrow("unknown series");
  });

  it("lists every leg of a collect and says when the relay collected on its own", () => {
    const legs = [
      { series: SERIES, amount: 500_000n },
      { series: PUT, amount: 1_000_000n },
    ];
    expect(text({ kind: "collect", accountId: "bob.near", legs, payout: 12_400_000n, txHash: "c0l", auto: false })).toBe(
      "💰 mainnet · Collect $12.40\n0.005 × BTC Up $110,000, ends 27 Nov 08:00 UTC · 0.01 × BTC Down $81,000, ends 28 Nov 09:00 UTC · bob.near · https://nearblocks.io/txns/c0l",
    );
    expect(text({ kind: "collect", accountId: "bob.near", legs: legs.slice(0, 1), payout: 400_000_000_000n, txHash: "c0l", auto: true })).toMatch(/^💰 mainnet · Auto-collect \$400,000\n/);
  });

  it("shows a free call's multiple capped at 25×", () => {
    const { id: _, ...terms } = SERIES;
    const call = { series_id: SERIES.id, account_id: "carol.near", terms, ask: "476000000", at_ms: 0 };
    expect(text({ kind: "call", call })).toBe("🎯 mainnet · Free call BTC Up $110,000, ends 27 Nov 08:00 UTC\npays up to 4.2× · carol.near");
    expect(text({ kind: "call", call: { ...call, ask: "1" } })).toContain("pays up to 25.0×");
  });

  it.each([
    ["issued", "📥 mainnet · Deposit address issued\n1.0 SOL on sol for about $100 · alice.near"],
    ["SUCCESS", "💵 mainnet · Deposit credited\n1.0 SOL on sol for about $100 · alice.near"],
    ["REFUNDED", "↩️ mainnet · Deposit refunded\n1.0 SOL on sol for about $100 · alice.near"],
    ["FAILED", "❌ mainnet · Deposit failed\n1.0 SOL on sol for about $100 · alice.near"],
    ["expired", "⌛ mainnet · Deposit expired\n1.0 SOL on sol for about $100 · alice.near · last status PENDING_DEPOSIT"],
  ] as const)("names a deposit that is %s", (outcome, message) => {
    expect(text({ kind: "deposit", deposit: { ...deposit, status: "PENDING_DEPOSIT" }, outcome })).toBe(message);
  });
});
