import { intentsAssetId, type QuoteEvent, type Series, shortTokenId } from "@near-options/sdk";
import type { Settings } from "../config.ts";
import { parseBookSummary } from "../deribit.ts";
import { Inventory } from "../inventory.ts";
import { KillSwitch } from "../killswitch.ts";
import { Market } from "../market.ts";
import type { Desk } from "../quote.ts";
import book from "./deribit-book-summary-btc.json" with { type: "json" };

export const NOW = 1_792_824_982_352;
export const SPOT = 80_656.17;
const OPTIONS = "opt.test.near";
export const USDC = "nep141:usdc.test.near";

const NOV27 = Date.UTC(2026, 10, 27, 8) / 1000;
const btcSeries = (id: string, kind: "call" | "put", strike: number, expiry = NOV27): Series => ({
  id,
  underlying: "BTC",
  kind,
  strike: (BigInt(strike) * 1_000_000n).toString(),
  width: "2000000000",
  expiry,
  underlying_decimals: 8,
});

export const PUT = btcSeries("BTC-27NOV26-80000_78000-P", "put", 80_000);
export const CALL = btcSeries("BTC-27NOV26-90000_92000-C", "call", 90_000);
export const DEMO_PUT = btcSeries("BTC-24OCT26T0712-80000_78000-P", "put", 80_000, Date.UTC(2026, 9, 24, 7, 12) / 1000);

export const long = (s: Series) => intentsAssetId(OPTIONS, s.id);
export const short = (s: Series) => intentsAssetId(OPTIONS, shortTokenId(s.id));

export const SETTINGS: Settings = {
  spreadVol: 0.02,
  minPremiumUsd: 1,
  hedgeFee: 0.00045,
  carryQuote: 0.07,
  maxTradeUsd: 2_000,
  maxSeriesUsd: 5_000,
  maxDeltaUsd: 2_000,
  maxVegaUsd: 200,
  hedgeBandUsd: 50,
  maxDataAgeMs: 10_000,
};

export const PAIRS = 5_000_000n;

export function testDesk(writeCutoffSec = 1_800, balances: [string, bigint][] = []) {
  const market = new Market();
  market.set("BTC", parseBookSummary(book.result, NOW), { price: SPOT, at: NOW });
  const inventory = new Inventory();
  inventory.setBalances(
    new Map([
      [USDC, 10_000_000_000n],
      [long(PUT), PAIRS],
      [short(PUT), PAIRS],
      [long(DEMO_PUT), PAIRS],
      [short(DEMO_PUT), PAIRS],
      [long(CALL), PAIRS],
      [short(CALL), PAIRS],
      ...balances,
    ]),
    NOW,
  );
  const kill = new KillSwitch(() => {});
  const desk: Desk = {
    book: { optionsId: OPTIONS, quoteAsset: USDC, quoteDecimals: 6, writeCutoffSec, series: new Map([PUT, CALL, DEMO_PUT].map((s) => [s.id, s])) },
    intents: { fee: 1n, salt: Uint8Array.from([0xd1, 0x79, 0x59, 0xa4]) },
    market,
    inventory,
    hedges: new Map([["BTC", 0]]),
    halted: () => kill.reason(),
  };
  return { desk, inventory, kill };
}

export function quoteEvent(series: Series, side: "buy" | "sell", size: bigint, overrides: Partial<QuoteEvent> = {}): QuoteEvent {
  return {
    quote_id: `q-${side}-${size}-${Math.random()}`,
    series_id: series.id,
    side,
    size: size.toString(),
    option_asset: long(series),
    quote_asset: USDC,
    fee_pips: 1,
    deadline_ms: NOW + 1_500,
    terms: { underlying: "BTC", expiry: series.expiry, strike: series.strike, width: series.width, kind: series.kind, underlying_decimals: 8 },
    ...overrides,
  };
}
