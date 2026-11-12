import { type Rounding, scaledAbs } from "@endline/sdk";

export { dollarDigits, formatMultiple, formatPrice, formatToken, formatUnits, formatUsd } from "@endline/sdk";

export function parseUnits(text: string, decimals: number): bigint | null {
  const match = /^(\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d*))?$/.exec(text.trim());
  if (!match || (match[1] === "" && !match[2])) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]!.replaceAll(",", "") || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

const MIN_BUDGET_CENTS = 100n;

export function minTrade(quoteDecimals: number): bigint {
  return (MIN_BUDGET_CENTS * 10n ** BigInt(quoteDecimals)) / 100n;
}

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

export function formatPct(fraction: number): string {
  const pct = fraction * 100;
  const digits = Math.abs(pct) < 10 ? 1 : 0;
  const rounded = Number(pct.toFixed(digits)) || 0;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}%`;
}
