import { capPrice } from "./math.ts";
import type { Series } from "./protocol.ts";

export type OptionKind = "call" | "put";

const SHORT_SUFFIX = "-SHORT";
export const SECONDS_PER_DAY = 86_400;
export const EXPIRY_TIME_OF_DAY = 8 * 3_600;
export const CLAIM_WINDOW_SEC = 7 * SECONDS_PER_DAY;
export const TWAP_WINDOW_SEC = 1_800;

const DEFAULT_LEAD_SEC = 6 * 3_600;
const STEP_OF_PRICE = 0.015;
const WIDTH_STEPS = 2n;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface SeriesParams {
  underlying: string;
  expiry: number;
  strike: bigint;
  width: bigint;
  quoteDecimals: number;
  kind: OptionKind;
}

export function seriesId({ underlying, expiry, strike, width, quoteDecimals, kind }: SeriesParams): string {
  const prices = `${formatStrike(strike, quoteDecimals)}_${formatStrike(capPrice({ kind, strike, width }), quoteDecimals)}`;
  return `${underlying}-${formatExpiry(expiry)}-${prices}-${kind === "call" ? "C" : "P"}`;
}

// Deribit-style points are stamped at the end of their minute, so the window is (expiry - TWAP_WINDOW_SEC, expiry]
export function twapPoints(points: [number, number][], expiry: number, untilMs = Infinity): number[] {
  const end = Math.min(expiry * 1000, untilMs);
  return points.filter(([ms]) => ms > (expiry - TWAP_WINDOW_SEC) * 1000 && ms <= end).map(([, price]) => price);
}

export function defaultExpiry(expiries: number[], nowSec: number): number | undefined {
  return expiries.find((expiry) => expiry - nowSec >= DEFAULT_LEAD_SEC) ?? expiries[0];
}

export function strikeStepCents(price: number): bigint {
  const max = price * 100 * STEP_OF_PRICE;
  if (!Number.isFinite(max)) throw new Error(`no strike step for ${price}`);
  let step = 1n;
  for (let power = 1n; ; power *= 10n) {
    for (const m of [1n, 2n, 5n]) {
      if (Number(m * power) > max) return step;
      step = m * power;
    }
  }
}

export function listedWidth(strike: bigint, quoteDecimals: number): bigint {
  return WIDTH_STEPS * strikeStepCents(Number(strike) / 10 ** quoteDecimals) * 10n ** BigInt(quoteDecimals - 2);
}

export function isListed(series: Pick<Series, "strike" | "width">, quoteDecimals: number): boolean {
  return BigInt(series.width) === listedWidth(BigInt(series.strike), quoteDecimals);
}

function formatExpiry(expiry: number): string {
  const date = new Date(expiry * 1000);
  const year = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const day = `${date.getUTCDate()}${MONTHS[date.getUTCMonth()]}${year}`;
  if (expiry % SECONDS_PER_DAY === EXPIRY_TIME_OF_DAY) return day;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function formatStrike(strike: bigint, quoteDecimals: number): string {
  const scale = 10n ** BigInt(quoteDecimals);
  const whole = strike / scale;
  const frac = strike % scale;
  if (frac === 0n) return whole.toString();
  const digits = frac.toString().padStart(quoteDecimals, "0").replace(/0+$/, "");
  return `${whole}d${digits}`;
}

export function longTokenId(seriesId: string): string {
  return seriesId;
}

export function shortTokenId(seriesId: string): string {
  return `${seriesId}${SHORT_SUFFIX}`;
}

export function parseTokenId(tokenId: string): { seriesId: string; side: "long" | "short" } {
  return tokenId.endsWith(SHORT_SUFFIX)
    ? { seriesId: tokenId.slice(0, -SHORT_SUFFIX.length), side: "short" }
    : { seriesId: tokenId, side: "long" };
}

export function intentsAssetId(optionsContract: string, tokenId: string): string {
  return `nep245:${optionsContract}:${tokenId}`;
}
