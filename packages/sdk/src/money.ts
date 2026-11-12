export type Rounding = "down" | "up";

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function scaledAbs(abs: bigint, decimals: number, fractionDigits: number, rounding: Rounding): bigint {
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

export function formatMultiple(tenths: bigint): string {
  return `${tenths / 10n}.${tenths % 10n}×`;
}
