import { MIN_RELAYED_PAYOUT_USD } from "@endline/sdk";

const MAX_TOKENS = 10;

export const minRelayedPayout = (quoteDecimals: number) => MIN_RELAYED_PAYOUT_USD * 10n ** BigInt(quoteDecimals);

// largest payouts first, so the relayed batches carry most of the money
export function collectBatches<T extends { payout: bigint }>(views: T[], minPayout: bigint): { views: T[]; relayed: boolean }[] {
  const sorted = [...views].sort((a, b) => (a.payout === b.payout ? 0 : a.payout > b.payout ? -1 : 1));
  return Array.from({ length: Math.ceil(sorted.length / MAX_TOKENS) }, (_, i) => sorted.slice(i * MAX_TOKENS, (i + 1) * MAX_TOKENS)).map((batch) => ({
    views: batch,
    relayed: batch.reduce((sum, v) => sum + v.payout, 0n) >= minPayout,
  }));
}
