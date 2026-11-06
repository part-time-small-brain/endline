import { setTimeout as sleep } from "node:timers/promises";
import { CLAIM_WINDOW_SEC, closeOptions, exerciseOptions, intentsAssetId, shortTokenId, writeOptions } from "@endline/sdk";
import { Chain } from "./chain.ts";
import type { Config } from "./config.ts";
import { indexPrice } from "./deribit.ts";
import { type Holding, type Market, planBurns, planExercises, planRedeems, planWrites, settlementKey, targets, watched } from "./listing.ts";
import { WRITE_TTL_MS } from "./write.ts";

const TICK_MS = 600_000;
const CREATE_DEPOSIT = 50_000_000_000_000_000_000_000n;
const BALANCE_PAGE = 200;
const ACTION_GAP_MS = 3_000;
const DELETE_BATCH = 20;
const DELETE_CHECK = 100;

export async function listCommand(config: Config, once: boolean): Promise<void> {
  const chain = new Chain(config);
  for (;;) {
    try {
      await tick(chain, config);
    } catch (e) {
      console.error(`list: ${e}`);
    }
    if (once) return;
    await sleep(TICK_MS);
  }
}

async function attempt(action: string, run: () => Promise<string>): Promise<boolean> {
  await sleep(ACTION_GAP_MS);
  try {
    console.log(`list: ${action}: tx ${await run()}`);
    return true;
  } catch (e) {
    console.error(`list: ${action} failed: ${e}`);
    return false;
  }
}

async function tick(chain: Chain, config: Config): Promise<void> {
  const [terms, underlyings, listed] = await Promise.all([chain.listingTerms(), chain.underlyings(), chain.seriesFrom(Math.floor(Date.now() / 1000) - CLAIM_WINDOW_SEC)]);
  const markets: Market[] = [];
  for (const u of underlyings) {
    try {
      markets.push({ ...u, spot: await indexPrice(u.index) });
    } catch (e) {
      console.error(`list: ${u.symbol} spot: ${e}`);
    }
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const wanted = terms.paused ? [] : targets(terms, markets, nowSec, config.settings.maxSeriesUsd);
  const ids = new Set(listed.map((s) => s.id));
  for (const t of wanted.filter((t) => !ids.has(t.id))) {
    if (await attempt(`create ${t.id}`, () => chain.createSeries(t.underlying, t.strike, t.width, t.expiry, t.kind, CREATE_DEPOSIT))) ids.add(t.id);
  }

  const open = wanted.filter((t) => ids.has(t.id));
  const recent = watched(listed, nowSec);
  const long = (id: string) => intentsAssetId(config.optionsId, id);
  const short = (id: string) => intentsAssetId(config.optionsId, shortTokenId(id));
  const tokenIds = [...new Set([...open.map((t) => t.id), ...recent.map((s) => s.id)])];
  const assets = [terms.quoteAsset, ...tokenIds.flatMap((id) => [long(id), short(id)])];
  const balances = new Map<string, bigint>();
  for (let i = 0; i < assets.length; i += BALANCE_PAGE) for (const [a, v] of await chain.balances(assets.slice(i, i + BALANCE_PAGE))) balances.set(a, v);
  const held = (asset: string) => balances.get(asset) ?? 0n;

  const longs = new Map(open.map((t) => [t.id, held(long(t.id))]));
  for (const w of planWrites(open, markets, terms, longs, balances)) {
    await attempt(`write ${w.id} with ${w.collateral} ${terms.quoteAsset}`, () =>
      chain.submit(writeOptions(config.optionsId, terms.quoteAsset, w.collateral, w.id), Date.now() + WRITE_TTL_MS),
    );
  }

  const holdings: Holding[] = recent.map((series) => ({ series, long: held(long(series.id)), short: held(short(series.id)) }));
  for (const b of planBurns(holdings, terms.writeCutoffSec, nowSec)) {
    const tokens = { [long(b.id)]: b.amount, [short(b.id)]: b.amount };
    await attempt(`burn_pair ${b.id} x${b.amount}`, () => chain.submit(closeOptions(config.optionsId, "burn_pair", tokens), Date.now() + WRITE_TTL_MS));
  }

  const prices = new Map<string, bigint>();
  const expired = new Map(holdings.filter((h) => h.long !== h.short && h.series.expiry <= nowSec).map((h) => [settlementKey(h.series), h.series]));
  for (const [key, { underlying, expiry }] of expired) {
    try {
      const settlement = await chain.settlement(underlying, expiry);
      if (settlement && nowSec >= settlement.final_at) prices.set(key, BigInt(settlement.price));
    } catch (e) {
      console.error(`list: settlement ${key}: ${e}`);
    }
  }
  const named = (batch: { id: string; amount: bigint }[]) => batch.map((c) => `${c.id} x${c.amount}`).join(", ");
  for (const batch of planRedeems(holdings, new Set(prices.keys()))) {
    const tokens = Object.fromEntries(batch.map((c) => [short(c.id), c.amount]));
    await attempt(`redeem ${named(batch)}`, () => chain.submit(closeOptions(config.optionsId, "redeem", tokens), Date.now() + WRITE_TTL_MS));
  }
  for (const batch of planExercises(holdings, prices)) {
    const tokens = Object.fromEntries(batch.map((c) => [long(c.id), c.amount]));
    await attempt(`exercise ${named(batch)}`, () => chain.submit(exerciseOptions(config.optionsId, tokens), Date.now() + WRITE_TTL_MS));
  }

  const old = await chain.seriesFrom(0, nowSec - CLAIM_WINDOW_SEC);
  const done: string[] = [];
  for (let i = 0; i < old.length; i += DELETE_CHECK) done.push(...(await chain.deletableSeries(old.slice(i, i + DELETE_CHECK).map((s) => s.id))));
  for (let i = 0; i < done.length; i += DELETE_BATCH) {
    const batch = done.slice(i, i + DELETE_BATCH);
    await attempt(`delete ${batch.join(", ")}`, () => chain.deleteSeries(batch));
  }
  console.log(`list: ${wanted.length} targets, ${open.length} listed${terms.paused ? ", contract paused" : ""}`);
}
