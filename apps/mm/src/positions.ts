import type { Series } from "@endline/sdk";
import { Chain } from "./chain.ts";
import type { Config } from "./config.ts";
import { Market } from "./market.ts";
import { type Book, contracts, exposure, greeks, longAsset, seriesMark, shortAsset } from "./portfolio.ts";

export async function positionsCommand(config: Config): Promise<void> {
  const chain = new Chain(config);
  const [contract, underlyings, all] = await Promise.all([chain.contractConfig(), chain.underlyings(), chain.series()]);
  const book: Book = { ...contract, optionsId: config.optionsId, series: new Map(all.map((s) => [s.id, s])) };
  const market = new Market();
  const [balances] = await Promise.all([
    chain.balances([book.quoteAsset, ...all.flatMap((s) => [longAsset(book, s.id), shortAsset(book, s.id)])]),
    market.refresh(underlyings),
  ]);
  const now = Date.now();
  const mark = (s: Series) => seriesMark(market, book, s);

  console.log(`account ${config.accountId} on ${config.intentsId}`);
  console.log(`  ${book.quoteAsset}: ${balances.get(book.quoteAsset) ?? 0n}`);

  for (const s of all) {
    const long = balances.get(longAsset(book, s.id)) ?? 0n;
    const short = balances.get(shortAsset(book, s.id)) ?? 0n;
    if (long === 0n && short === 0n) continue;
    const m = s.expiry * 1000 > now ? mark(s) : undefined;
    let detail = "expired or no market data";
    if (m) {
      const g = greeks(book, s, m, now);
      detail = `iv ${(m.vol * 100).toFixed(1)}%/${(m.capVol * 100).toFixed(1)}% fwd ${m.forward.toFixed(0)} delta ${g.delta.toFixed(3)} vega $${g.vega.toFixed(2)}`;
    }
    console.log(`${s.id}: long ${contracts(s, long)} short ${contracts(s, short)} | ${detail}`);
  }

  const exposures = exposure(book, balances, mark, now);
  for (const [coin, options] of exposures) {
    const spot = market.spot(coin)?.price ?? Number.NaN;
    console.log(`${coin}: delta ${options.delta.toFixed(5)} ($${(options.delta * spot).toFixed(0)}) vega $${options.vega.toFixed(2)}`);
  }
}
