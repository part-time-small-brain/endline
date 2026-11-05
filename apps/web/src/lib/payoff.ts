import { capPrice, longPayout, type Terms } from "@near-options/sdk";

export function breakeven(t: Terms, size: bigint, premium: bigint): bigint | null {
  const up = t.kind === "call";
  const cap = capPrice(t);
  if (size <= 0n || longPayout(t, size, cap) < premium) return null;
  const pays = (price: bigint) => longPayout(t, size, price) >= premium;
  let [low, high] = up ? [t.strike, cap] : [cap, t.strike];
  while (low < high) {
    if (up) {
      const mid = (low + high) / 2n;
      if (pays(mid)) high = mid;
      else low = mid + 1n;
    } else {
      const mid = (low + high + 1n) / 2n;
      if (pays(mid)) low = mid;
      else high = mid - 1n;
    }
  }
  return low;
}

export function sizeForBudget(budget: bigint, pricePerContract: bigint, unit: bigint): bigint {
  return pricePerContract > 0n && budget > 0n ? (budget * unit) / pricePerContract : 0n;
}

export function costOf(size: bigint, pricePerContract: bigint, unit: bigint): bigint {
  return (size * pricePerContract + unit - 1n) / unit;
}
