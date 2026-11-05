import { type Diff, grossFor, netOf } from "./fees.ts";

interface Trade {
  option: string;
  quote: string;
  size: bigint;
  premium: bigint;
  pips: bigint;
}

export interface TradeDiffs {
  user: Diff;
  marketMaker: Diff;
}

export function buyDiffs({ option, quote, size, premium, pips }: Trade): TradeDiffs {
  return {
    user: { [quote]: -premium, [option]: size },
    marketMaker: { [quote]: netOf(quote, premium, pips), [option]: -grossFor(option, size, pips) },
  };
}

export function sellDiffs({ option, quote, size, premium, pips }: Trade): TradeDiffs {
  return {
    user: { [option]: -size, [quote]: premium },
    marketMaker: { [option]: netOf(option, size, pips), [quote]: -grossFor(quote, premium, pips) },
  };
}
