import { twapPoints } from "@endline/sdk";
import { z } from "zod";

const API = "https://www.deribit.com/api/v2/public";
const TIMEOUT_MS = 5_000;

export interface Mark {
  vol: number;
  forward: number;
  at: number;
}

export interface Instrument {
  underlying: string;
  expiry: number;
  strike: number;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const INSTRUMENT = /^([A-Z_]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-[CP]$/;
const DELIVERY_HOUR_UTC = 8;
const DAY_SEC = 86_400;
const MIN_POINTS = 25;

export function parseInstrument(name: string): Instrument | undefined {
  const m = INSTRUMENT.exec(name);
  if (!m) return undefined;
  const [, underlying = "", day, month = "", year, strike = ""] = m;
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex < 0) return undefined;
  const expiry = Date.UTC(2000 + Number(year), monthIndex, Number(day), DELIVERY_HOUR_UTC) / 1000;
  return { underlying, expiry, strike: Number(strike.replace("d", ".")) };
}

const MarkRow = z.object({
  instrument_name: z.string(),
  mark_iv: z.number().positive(),
  underlying_price: z.number().positive(),
});

const IndexPrice = z.object({ index_price: z.number().positive() });
const DeliveryPrices = z.object({ data: z.array(z.object({ date: z.string(), delivery_price: z.number().positive() })) });
const IndexChart = z.array(z.tuple([z.number(), z.number().positive()]));

async function get(method: string, params: Record<string, string>): Promise<unknown> {
  const url = `${API}/${method}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`deribit ${method}: HTTP ${res.status}`);
  const body = z.object({ result: z.unknown() }).parse(await res.json());
  return body.result;
}

export function parseBookSummary(result: unknown, at: number): Map<string, Mark> {
  const marks = new Map<string, Mark>();
  for (const row of z.array(z.unknown()).parse(result)) {
    const parsed = MarkRow.safeParse(row);
    if (parsed.success) marks.set(parsed.data.instrument_name, { vol: parsed.data.mark_iv / 100, forward: parsed.data.underlying_price, at });
  }
  return marks;
}

export async function bookSummary(currency: string): Promise<Map<string, Mark>> {
  const at = Date.now();
  return parseBookSummary(await get("get_book_summary_by_currency", { currency, kind: "option" }), at);
}

export async function indexPrice(index: string): Promise<number> {
  return IndexPrice.parse(await get("get_index_price", { index_name: index })).index_price;
}

export function settlementReferences(): (index: string, expiry: number) => Promise<number | undefined> {
  const responses = new Map<string, Promise<unknown>>();
  const once = (method: string, params: Record<string, string>) => {
    const key = `${method}?${new URLSearchParams(params)}`;
    if (!responses.has(key)) responses.set(key, get(method, params));
    return responses.get(key)!;
  };
  return async (index, expiry) => {
    if (expiry % DAY_SEC === DELIVERY_HOUR_UTC * 3_600) {
      const day = new Date(expiry * 1000).toISOString().slice(0, 10);
      const { data } = DeliveryPrices.parse(await once("get_delivery_prices", { index_name: index, offset: "0", count: "30" }));
      return data.find((row) => row.date === day)?.delivery_price;
    }
    const points = IndexChart.parse(await once("get_index_chart_data", { index_name: index, range: "1d" }));
    const window = twapPoints(points, expiry);
    return window.length >= MIN_POINTS ? window.reduce((sum, price) => sum + price, 0) / window.length : undefined;
  };
}
