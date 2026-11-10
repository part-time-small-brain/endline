import { setTimeout as sleep } from "node:timers/promises";
import { Chain } from "./chain.ts";
import type { Config } from "./config.ts";
import { CHAIN_LAG_MS, Inventory } from "./inventory.ts";
import { Market } from "./market.ts";
import { marks } from "./marks.ts";
import { type Book, liveAssets } from "./portfolio.ts";
import { type Desk, QUOTE_TTL_MS } from "./quote.ts";
import { Quoter } from "./quoter.ts";
import { RelayClient } from "./relay.ts";
import { nep413Signer } from "./signer.ts";

const MARKET_MS = 2_000;
const INVENTORY_MS = 5_000;
const INTENTS_MS = 60_000;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

export async function runBot(config: Config, relay: { url: string; apiKey: string }): Promise<void> {
  const chain = new Chain(config);
  const [contract, underlyings, intents] = await Promise.all([chain.contractConfig(), chain.underlyings(), chain.intentsState()]);
  const book: Book = { ...contract, optionsId: config.optionsId, series: new Map() };
  const market = new Market();
  const inventory = new Inventory();
  const desk: Desk = { book, intents, market, inventory };

  const refreshInventory = async () => {
    book.series = new Map((await chain.seriesFrom(Math.floor(Date.now() / 1000))).map((s) => [s.id, s]));
    const startedAt = Date.now();
    inventory.setBalances(await chain.balances(liveAssets(book, startedAt)), startedAt);
  };
  const refreshIntents = async () => {
    desk.intents = await chain.intentsState();
  };

  await Promise.all([refreshInventory(), market.refresh(underlyings)]);

  const every = (ms: number, task: () => Promise<void>, name: string) =>
    setInterval(() => task().catch((e) => log(`${name} failed: ${e instanceof Error ? e.message : e}`)), ms);
  const timers = [
    every(MARKET_MS, () => market.refresh(underlyings).finally(() => client.publish(marks(desk, config.settings, Date.now()))), "market refresh"),
    every(INVENTORY_MS, refreshInventory, "inventory refresh"),
    every(INTENTS_MS, refreshIntents, "intents state refresh"),
  ];

  const client = new RelayClient(relay.url, relay.apiKey, { quote: (ev) => void quoter.onQuote(ev), status: (u) => quoter.onStatus(u) }, log);
  const quoter = new Quoter({
    desk,
    settings: config.settings,
    intentsId: config.intentsId,
    accountId: config.accountId,
    sign: nep413Signer(config.privateKey),
    send: (r) => client.send(r),
    onFill: () => setTimeout(() => void refreshInventory().catch((e) => log(`post-fill inventory refresh failed: ${e}`)), CHAIN_LAG_MS + 500),
    log,
  });
  await sleep(QUOTE_TTL_MS + CHAIN_LAG_MS);
  await refreshInventory();
  client.start();

  const stop = () => {
    log("stopping: no new quotes; signed quotes stay valid until their deadline (max 25 s)");
    client.close();
    for (const t of timers) clearInterval(t);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
