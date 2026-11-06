import { defaultExpiry, isListed, type Mark, type OptionKind, type Series } from "@endline/sdk";
import { useState } from "react";
import { useData } from "../../app/data.tsx";
import { toUnits } from "../../lib/money.ts";
import { presets } from "../../lib/targets.ts";
import { exampleMark } from "../../mock/marks.ts";
import { createWorld, QUOTE_DECIMALS, type Underlying, UNDERLYINGS, WRITE_CUTOFF_SEC } from "../../mock/world.ts";

export interface DemoAsset {
  symbol: string;
  spot: number;
  marks: Record<string, Mark>;
  strikes: Record<OptionKind, Series[]>;
}

export interface DemoMarket {
  live: boolean;
  quoteDecimals: number;
  assets: DemoAsset[];
}

const byStrike = (a: Series, b: Series) => (BigInt(a.strike) < BigInt(b.strike) ? -1 : 1);

export function balancedOf(asset: DemoAsset, kind: OptionKind, quoteDecimals: number): Series | undefined {
  const list = asset.strikes[kind];
  const index = presets(list.map((s) => BigInt(s.strike)), kind, toUnits(asset.spot, quoteDecimals)).find((p) => p.name === "Balanced")?.index;
  return index === undefined ? undefined : list[index];
}

function assetsOf(series: Series[], spot: Record<string, number>, marks: Record<string, Mark>, nowSec: number): DemoAsset[] {
  const open = series.filter((s) => marks[s.id]);
  return [...new Set(open.map((s) => s.underlying))].sort().flatMap((symbol) => {
    const own = open.filter((s) => s.underlying === symbol);
    const expiry = defaultExpiry([...new Set(own.map((s) => s.expiry))].sort((a, b) => a - b), nowSec);
    const of = (kind: OptionKind) => own.filter((s) => s.kind === kind && s.expiry === expiry).sort(byStrike);
    const strikes = { call: of("call"), put: of("put") };
    const price = spot[symbol];
    if (expiry === undefined || price === undefined || strikes.call.length < 2 || strikes.put.length < 2) return [];
    return [{ symbol, spot: price, marks, strikes }];
  });
}

export function useDemoMarket(nowSec: number): { market: DemoMarket | undefined; example: DemoMarket } {
  const { listing, market, marks, quoteDecimals } = useData();
  const [example] = useState<DemoMarket>(() => {
    const world = createWorld();
    const listed = world.series.filter((s) => isListed(s, QUOTE_DECIMALS) && s.expiry - nowSec > WRITE_CUTOFF_SEC);
    const examples = listed.flatMap((s) => exampleMark(s, world.spot[s.underlying as Underlying], UNDERLYINGS[s.underlying as Underlying].vol, nowSec, QUOTE_DECIMALS) ?? []);
    const byId = Object.fromEntries(examples.map((m) => [m.series_id, m]));
    return { live: false, quoteDecimals: QUOTE_DECIMALS, assets: assetsOf(listed, world.spot, byId, nowSec) };
  });

  const live = listing && market && marks ? assetsOf(listing.series.filter((s) => s.quotable), market.spot, marks, nowSec) : [];
  return { market: live.length > 0 ? { live: true, quoteDecimals, assets: live } : undefined, example };
}
