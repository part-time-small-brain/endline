import { z } from "zod";

export interface MarketSnapshot {
  spot: Record<string, number>;
}

export type PricePoint = [ms: number, price: number];

const CHART_STEP_MS = 300_000;
const DERIBIT_TIMEOUT_MS = 5_000;

export function chartPoints(points: PricePoint[]): PricePoint[] {
  const bucket = (ms: number) => Math.floor(ms / CHART_STEP_MS);
  return points.filter(([ms], i) => i === 0 || i === points.length - 1 || bucket(ms) !== bucket(points[i - 1]![0]));
}

export interface Market {
  snapshot(underlyings: string[]): Promise<MarketSnapshot>;
  history(underlying: string): Promise<PricePoint[]>;
}

const Index = z.object({ result: z.object({ index_price: z.number().positive() }) });
const IndexChart = z.object({ result: z.array(z.tuple([z.number(), z.number().positive()])) });

async function index(name: string): Promise<number> {
  const response = await fetch(`https://www.deribit.com/api/v2/public/get_index_price?index_name=${name}`, { signal: AbortSignal.timeout(DERIBIT_TIMEOUT_MS) });
  return Index.parse(await response.json()).result.index_price;
}

export function deribitMarket(): Market {
  return {
    async snapshot(underlyings) {
      const settled = await Promise.allSettled(
        underlyings.map(async (symbol) => [symbol, await index(`${symbol.toLowerCase()}_usd`)] as const),
      );
      const rows = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const failure = settled.find((result) => result.status === "rejected");
      if (rows.length === 0 && failure) throw failure.reason;
      return { spot: Object.fromEntries(rows) };
    },
    async history(underlying) {
      const response = await fetch(`https://www.deribit.com/api/v2/public/get_index_chart_data?index_name=${underlying.toLowerCase()}_usd&range=1d`, { signal: AbortSignal.timeout(DERIBIT_TIMEOUT_MS) });
      return IndexChart.parse(await response.json()).result;
    },
  };
}
