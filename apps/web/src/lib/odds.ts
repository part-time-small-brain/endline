import { black76, type Mark, type Series, YEAR_MS } from "@near-options/sdk";

export function chance(series: Pick<Series, "kind" | "strike" | "expiry">, spot: number, vol: number, nowSec: number, quoteDecimals: number): number {
  const strike = Number(series.strike) / 10 ** quoteDecimals;
  const years = ((series.expiry - nowSec) * 1000) / YEAR_MS;
  if (!(spot > 0 && vol > 0 && years > 0 && strike > 0)) return (series.kind === "call" ? spot > strike : spot < strike) ? 1 : 0;
  const call = black76("call", spot, strike, vol, years);
  const above = Math.min(Math.max((spot * call.callDelta - call.price) / strike, 0), 1);
  return series.kind === "call" ? above : 1 - above;
}

export function nearestVol(series: Pick<Series, "id" | "strike">[], marks: Record<string, Mark> | undefined, spot: bigint): number | undefined {
  const distance = (s: Pick<Series, "strike">) => (BigInt(s.strike) > spot ? BigInt(s.strike) - spot : spot - BigInt(s.strike));
  const priced = series.filter((s) => marks?.[s.id]).sort((a, b) => (distance(a) < distance(b) ? -1 : 1));
  return priced[0] && marks?.[priced[0].id]?.vol;
}
