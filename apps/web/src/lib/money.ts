type Rounding = "down" | "up";

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function scaledAbs(abs: bigint, decimals: number, fractionDigits: number, rounding: Rounding): bigint {
  const shift = decimals - fractionDigits;
  if (shift < 0) return abs * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  return abs / divisor + (rounding === "up" && abs % divisor !== 0n ? 1n : 0n);
}

export function formatUnits(value: bigint, decimals: number, fractionDigits: number, rounding: Rounding = "down"): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scaled = scaledAbs(abs, decimals, fractionDigits, rounding);
  const text = scaled.toString().padStart(fractionDigits + 1, "0");
  const whole = text.slice(0, text.length - fractionDigits);
  const fraction = text.slice(text.length - fractionDigits);
  const body = fractionDigits > 0 ? `${grouped(whole)}.${fraction}` : grouped(whole);
  return negative && scaled !== 0n ? `-${body}` : body;
}

const WHOLE_FROM_CENTS = 10_000n;

export function dollarDigits(abs: bigint, decimals: number, rounding: Rounding = "down"): number {
  return scaledAbs(abs, decimals, 2, rounding) >= WHOLE_FROM_CENTS ? 0 : 2;
}

export function formatUsd(value: bigint, decimals: number, rounding: Rounding = "down"): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  if (abs > 0n && abs < 10n ** BigInt(Math.max(decimals - 2, 0))) return `${sign}<$0.01`;
  return `${sign}$${formatUnits(abs, decimals, dollarDigits(abs, decimals, rounding), rounding)}`;
}

export function formatPrice(value: bigint, decimals: number, rounding: Rounding = "down"): string {
  return `$${formatUnits(value, decimals, dollarDigits(value, decimals, rounding), rounding)}`;
}

export function formatToken(value: bigint, decimals: number, maxFraction = 8): string {
  const text = formatUnits(value, decimals, Math.min(decimals, maxFraction));
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function parseUnits(text: string, decimals: number): bigint | null {
  const match = /^(\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match || (match[1] === "" && !match[2])) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]!.replaceAll(",", "") || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

const MIN_BUDGET_CENTS = 100n;

export function parseBudget(text: string, quoteDecimals: number): bigint | null {
  const cents = parseUnits(text, 2);
  return cents === null || cents < MIN_BUDGET_CENTS ? null : (cents * 10n ** BigInt(quoteDecimals)) / 100n;
}

export function toUnits(value: number, decimals: number): bigint {
  return BigInt(Math.round(value * 10 ** Math.min(decimals, 8))) * 10n ** BigInt(Math.max(decimals - 8, 0));
}

export function toRounded(value: bigint, decimals: number, fractionDigits: number, rounding: Rounding = "down"): number {
  const abs = scaledAbs(value < 0n ? -value : value, decimals, fractionDigits, rounding);
  return (value < 0n ? -Number(abs) : Number(abs)) / 10 ** fractionDigits || 0;
}

export function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

export function formatChance(fraction: number): string {
  const pct = Math.round(fraction * 100);
  if (pct === 0 && fraction > 0) return "<1%";
  if (pct === 100 && fraction < 1) return ">99%";
  return `${pct}%`;
}

export function formatMultiple(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}×`;
}

export function formatPct(fraction: number): string {
  const pct = fraction * 100;
  const digits = Math.abs(pct) < 10 ? 1 : 0;
  const rounded = Number(pct.toFixed(digits)) || 0;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}
