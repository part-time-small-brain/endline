import { EXPIRY_TIME_OF_DAY, listedWidth, SECONDS_PER_DAY, type Series, seriesId } from "@endline/sdk";
import type { PricePoint } from "../api/market.ts";
import type { SettlementView } from "../lib/status.ts";

export const QUOTE_DECIMALS = 6;
export const WRITE_CUTOFF_SEC = 1_800;
export const START_BALANCE = 250_000_000n;

const HISTORY_STEP_SEC = 300;
const USD = 10n ** BigInt(QUOTE_DECIMALS);

export const UNDERLYINGS = {
  BTC: { decimals: 8, spot: 80_650, vol: 0.42, step: 1_000 },
} as const;
export type Underlying = keyof typeof UNDERLYINGS;

const nowSec = () => Math.floor(Date.now() / 1000);
const lastExpiry = (now: number) => Math.floor((now - EXPIRY_TIME_OF_DAY) / SECONDS_PER_DAY) * SECONDS_PER_DAY + EXPIRY_TIME_OF_DAY;

function make(underlying: Underlying, kind: "call" | "put", strikeUsd: number, expiry: number, widthUsd?: number): Series {
  const strike = BigInt(strikeUsd) * USD;
  const width = widthUsd === undefined ? listedWidth(strike, QUOTE_DECIMALS) : BigInt(widthUsd) * USD;
  return {
    id: seriesId({ underlying, expiry, strike, width, quoteDecimals: QUOTE_DECIMALS, kind }),
    underlying,
    kind,
    strike: strike.toString(),
    width: width.toString(),
    expiry,
    underlying_decimals: UNDERLYINGS[underlying].decimals,
  };
}

function upcomingExpiries(now: number): number[] {
  const first = lastExpiry(now + WRITE_CUTOFF_SEC) + SECONDS_PER_DAY;
  const days = [first, first + SECONDS_PER_DAY];
  const friday = Array.from({ length: 7 }, (_, i) => first + i * SECONDS_PER_DAY).find((e) => new Date(e * 1000).getUTCDay() === 5);
  if (friday !== undefined && !days.includes(friday)) days.push(friday);
  days.push(first + 28 * SECONDS_PER_DAY);
  return days;
}

function gaussian(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function walk(spot: number, vol: number, now: number): PricePoint[] {
  const steps = SECONDS_PER_DAY / HISTORY_STEP_SEC;
  const sigma = vol / Math.sqrt(365 * steps);
  const logs = [0];
  for (let i = 1; i <= steps; i++) logs.push((logs[i - 1] ?? 0) + sigma * gaussian());
  const last = logs[steps] ?? 0;
  return logs.map((log, i) => [(now - (steps - i) * HISTORY_STEP_SEC) * 1000, spot * Math.exp(log - last)]);
}

interface Holding {
  series: Series;
  size: bigint;
  premium: bigint;
  boughtAgoSec: number;
}

export function createWorld() {
  const now = nowSec();
  const series: Series[] = [];
  for (const [symbol, u] of Object.entries(UNDERLYINGS) as [Underlying, (typeof UNDERLYINGS)[Underlying]][]) {
    const atm = Math.round(u.spot / u.step) * u.step;
    for (const expiry of upcomingExpiries(now)) {
      for (let k = -4; k <= 4; k++) {
        series.push(make(symbol, "call", atm + k * u.step, expiry), make(symbol, "put", atm + k * u.step, expiry));
      }
    }
  }
  const recent = lastExpiry(now);
  const settlements = new Map<string, SettlementView>([
    [`BTC:${recent - 2 * SECONDS_PER_DAY}`, { price: 82_410n * USD, finalAt: recent - 2 * SECONDS_PER_DAY + 3_900 }],
    [`BTC:${recent - 3 * SECONDS_PER_DAY}`, { price: 81_020n * USD, finalAt: recent - 3 * SECONDS_PER_DAY + 3_900 }],
    [`BTC:${recent - SECONDS_PER_DAY}`, { price: 81_420n * USD, finalAt: now + 40 * 60 }],
  ]);
  const holdings: Holding[] = [
    { series: make("BTC", "call", 80_000, recent - 2 * SECONDS_PER_DAY), size: 2_000_000n, premium: 18_400_000n, boughtAgoSec: 4 * SECONDS_PER_DAY },
    { series: make("BTC", "put", 79_000, recent - 3 * SECONDS_PER_DAY), size: 3_000_000n, premium: 22_000_000n, boughtAgoSec: 5 * SECONDS_PER_DAY },
    { series: make("BTC", "call", 79_000, recent - SECONDS_PER_DAY), size: 2_000_000n, premium: 15_200_000n, boughtAgoSec: 2 * SECONDS_PER_DAY },
    { series: make("BTC", "put", 80_000, recent), size: 1_500_000n, premium: 12_500_000n, boughtAgoSec: SECONDS_PER_DAY },
  ];
  series.push(...holdings.map((h) => h.series));
  const active = series.find((s) => s.underlying === "BTC" && s.kind === "call" && s.expiry - now > SECONDS_PER_DAY && BigInt(s.strike) > BigInt(UNDERLYINGS.BTC.spot) * USD);
  if (active) {
    const unlisted = make("BTC", "call", 85_500, active.expiry, 500);
    series.push(unlisted);
    holdings.push(
      { series: active, size: 3_000_000n, premium: 26_800_000n, boughtAgoSec: 6 * 3_600 },
      { series: unlisted, size: 1_000_000n, premium: 1_000_000n, boughtAgoSec: 3_600 },
    );
  }
  const spot: Record<Underlying, number> = { BTC: UNDERLYINGS.BTC.spot };
  const history: Record<Underlying, PricePoint[]> = { BTC: walk(spot.BTC, UNDERLYINGS.BTC.vol, now) };
  return { series, settlements, holdings, spot, history, start: now };
}
