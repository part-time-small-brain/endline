const PIPS_MAX = 1_000_000n;

export type Diff = Record<string, bigint>;

export function feeOf(asset: string, amount: bigint, pips: bigint): bigint {
  if (!asset.startsWith("nep141:") && !asset.startsWith("nep245:")) throw new Error(`not an intents asset: ${asset}`);
  if (pips < 0n || pips >= PIPS_MAX) throw new Error(`fee pips out of range: ${pips}`);
  if (amount <= 0n) throw new Error("amount must be positive");
  if (asset.startsWith("nep245:") && amount <= 1n) return 0n;
  return (amount * pips + PIPS_MAX - 1n) / PIPS_MAX;
}

export function netOf(asset: string, gross: bigint, pips: bigint): bigint {
  return gross - feeOf(asset, gross, pips);
}

export function grossFor(asset: string, net: bigint, pips: bigint): bigint {
  if (netOf(asset, net, pips) === net) return net;
  return (net * PIPS_MAX + PIPS_MAX - pips - 1n) / (PIPS_MAX - pips);
}

export function unmatched(diffs: Diff[], pips: bigint): Diff {
  const totals: Diff = {};
  for (const diff of diffs) {
    for (const [asset, delta] of Object.entries(diff)) {
      if (delta === 0n) throw new Error(`zero delta for ${asset}`);
      const fee = delta < 0n ? feeOf(asset, -delta, pips) : 0n;
      totals[asset] = (totals[asset] ?? 0n) + delta + fee;
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([, total]) => total !== 0n));
}
