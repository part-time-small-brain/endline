import { Mark, netOf } from "@endline/sdk";
import type { Settings } from "./config.ts";
import { contracts, longAsset, shortAsset } from "./portfolio.ts";
import { toQuoteUnits } from "./pricing.ts";
import { type Desk, priceSeries } from "./quote.ts";

// the relay closes a socket whose frame passes 64 KB; the rest is room for the envelope
const MAX_BYTES = 64_000;

export function marks(desk: Desk, settings: Settings, now: number): Mark[] {
  if (desk.halted()) return [];
  const { book } = desk;
  const held = desk.inventory.confirmed();
  const units = (usd: number, roundUp: boolean) => {
    try {
      return toQuoteUnits(usd, book.quoteDecimals, roundUp);
    } catch {
      return undefined;
    }
  };
  const tradeCap = units(settings.maxTradeUsd, false) ?? 0n;
  const ranked = [...book.series.values()].flatMap((series) => {
    const long = held.get(longAsset(book, series.id)) ?? 0n;
    const short = held.get(shortAsset(book, series.id)) ?? 0n;
    if (long === 0n && short === 0n) return [];
    const priced = priceSeries(desk, series, settings, now);
    if (!priced.ok) return [];
    const width = BigInt(series.width);
    const option = longAsset(book, series.id);
    const free = desk.inventory.available(option);
    const stock = free > 0n ? netOf(option, free, desk.intents.fee) : 0n;
    const capped = (tradeCap * 10n ** BigInt(series.underlying_decimals)) / width;
    const maxSize = stock < capped ? stock : capped;
    const lifted = maxSize > 0n ? units(Math.max(priced.price.ask, settings.minPremiumUsd / contracts(series, maxSize)), true) : undefined;
    const sells = lifted !== undefined && lifted < width;
    const ask = sells ? lifted : units(priced.price.ask, true);
    const bid = units(priced.price.bid, false) ?? 0n;
    if (ask === undefined || ask >= width) return [];
    const mark = Mark.safeParse({
      series_id: series.id,
      ask: ask.toString(),
      ...(bid > 0n ? { bid: bid.toString() } : {}),
      ...(sells ? { max_size: maxSize.toString() } : {}),
      vol: priced.price.vol,
    });
    if (!mark.success) return [];
    // at most what the tokens are worth, so outranking the MM's own series means giving it that much
    const stake = (long * bid + short * (width - ask)) / 10n ** BigInt(series.underlying_decimals);
    return [{ mark: mark.data, stake }];
  });
  const published: Mark[] = [];
  let bytes = 0;
  for (const { mark } of ranked.sort((a, b) => Number(b.stake - a.stake))) {
    bytes += JSON.stringify(mark).length + 1;
    if (bytes > MAX_BYTES) break;
    published.push(mark);
  }
  return published;
}
