import { longPayout, type Terms } from "./math.ts";
import { TWAP_WINDOW_SEC } from "./series.ts";

export const FREE_CALLS_PER_ROUND = 10;
const CALL_STAKE = 100;
export const MAX_CALL_MULTIPLE = 25;

const MAX_BACK = BigInt(CALL_STAKE * MAX_CALL_MULTIPLE);

export const roundOf = (expiry: number) => new Date(expiry * 1000).toISOString().slice(0, 10);

export const callableAt = (expiry: number, nowSec: number) => nowSec < expiry - TWAP_WINDOW_SEC;

export const nextRound = (callable: number[]): string | undefined => callable.map(roundOf).sort()[0];

// ask: quote units per terms.unit of option, as in a Mark
export function callPoints(terms: Terms, ask: bigint, price: bigint): number {
  const back = (longPayout(terms, terms.unit, price) * BigInt(CALL_STAKE)) / ask;
  return Number(back < MAX_BACK ? back : MAX_BACK) - CALL_STAKE;
}

export function callMultiple(terms: Terms, ask: bigint): bigint {
  const tenths = (terms.width * 10n) / ask;
  return tenths < BigInt(MAX_CALL_MULTIPLE * 10) ? tenths : BigInt(MAX_CALL_MULTIPLE * 10);
}
