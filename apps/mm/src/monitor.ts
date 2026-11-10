import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type Alert, dedupe, pendingAlerts, reserveAlert, settlementAlert } from "./alerts.ts";
import { ChainReader } from "./chain.ts";
import type { MonitorConfig } from "./config.ts";
import { settlementReferences } from "./deribit.ts";

const TICK_MS = 60_000;
const HTTP_TIMEOUT_MS = 5_000;
const Health = z.object({ ok: z.literal(true), market_makers: z.number() });
const Marks = z.array(z.unknown());

export async function monitorCommand(config: MonitorConfig, once: boolean): Promise<void> {
  const chain = new ChainReader(config.rpcUrl, config.optionsId);
  const final = new Set<string>();
  const open = new Set<string>();
  for (;;) {
    try {
      const { fresh, resolved } = dedupe(open, await check(chain, config, final, open));
      for (const alert of fresh) if (await notify(config.webhookUrl, `ALERT ${alert.text}`)) open.add(alert.key);
      for (const key of resolved) {
        const text = final.has(key.replace(/^settle /, "")) ? `FINAL ${key}: the flagged price is final now` : `RESOLVED ${key}`;
        if (await notify(config.webhookUrl, text)) open.delete(key);
      }
      console.log(`monitor: ${open.size} open alerts`);
    } catch (e) {
      console.error(`monitor: check failed: ${e}`);
    }
    if (once) return;
    await sleep(TICK_MS);
  }
}

async function check(chain: ChainReader, config: MonitorConfig, final: Set<string>, open: ReadonlySet<string>): Promise<Alert[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const accounts = [config.optionsId, config.intentsId, config.relayerId, config.mmId].filter((id) => id !== undefined);
  const reserves = Promise.all(
    accounts.map(async (id): Promise<Alert | undefined> => {
      try {
        const { amount, storageUsage } = await chain.nearBalance(id);
        return reserveAlert(id, amount, storageUsage);
      } catch (e) {
        return { key: `reserve ${id}`, text: `${id}: can't read balance: ${e}` };
      }
    }),
  );
  const pending = chain.pendingChanges().then(
    (changes) => pendingAlerts(config.optionsId, changes),
    (e): Alert[] => {
      console.error(`monitor: pending changes: ${e}`);
      const stillOpen = [...open].filter((key) => key.startsWith("pending")).map((key) => ({ key, text: "" }));
      return stillOpen.length > 0 ? stillOpen : [{ key: "pending", text: `${config.optionsId}: can't read pending changes: ${e}` }];
    },
  );
  const uptime = config.healthUrl === undefined ? [] : healthAlerts(config.healthUrl, open);
  const [terms, underlyings, series, reserveAlerts, pendingChangeAlerts, uptimeAlerts] = await Promise.all([chain.settlementTerms(), chain.underlyings(), chain.series(), reserves, pending, uptime]);
  const contract = { ...terms, optionsId: config.optionsId, networkId: config.networkId };
  const indexes = new Map(underlyings.map((u) => [u.symbol, u.index]));
  const expired = new Map(series.filter((s) => s.expiry <= nowSec).map((s) => [`${s.underlying} ${s.expiry}`, s]));
  const reference = settlementReferences();
  const alerts: (Alert | undefined)[] = [];
  for (const [key, { underlying, expiry }] of expired) {
    if (final.has(key)) continue;
    const settlement = await chain.settlement(underlying, expiry);
    if (settlement && nowSec >= settlement.final_at) {
      final.add(key);
      continue;
    }
    if (!settlement && nowSec < expiry + terms.oracleWindowSec) continue;
    const index = indexes.get(underlying);
    const price = index === undefined ? undefined : await reference(index, expiry).catch((e) => {
      console.error(`monitor: deribit ${index}: ${e}`);
      return undefined;
    });
    alerts.push(settlementAlert(contract, { underlying, expiry, settlement, reference: price }, nowSec));
  }
  return [...alerts, ...reserveAlerts, ...pendingChangeAlerts, ...uptimeAlerts].filter((a) => a !== undefined);
}

async function healthAlerts(url: string, open: ReadonlySet<string>): Promise<Alert[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = Health.safeParse(await res.json());
    if (!health.success) throw new Error("no ok: true in the body");
    if (health.data.market_makers === 0) return [{ key: "quotes", text: `${url}: no market maker connected, nobody gets a quote. Check the mm service` }];
  } catch (e) {
    const held = ["quotes", "priced"].filter((key) => open.has(key)).map((key) => ({ key, text: "" }));
    return [{ key: "uptime", text: `${url}: down: ${e}` }, ...held];
  }
  return pricedAlerts(new URL("/marks", url).toString(), open);
}

async function pricedAlerts(url: string, open: ReadonlySet<string>): Promise<Alert[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const marks = Marks.parse(await res.json());
    return marks.length > 0 ? [] : [{ key: "priced", text: `${url}: a market maker is connected but prices nothing. Check the lister's log and the MM's USDC and NEAR` }];
  } catch (e) {
    console.error(`monitor: ${url}: ${e}`);
    return open.has("priced") ? [{ key: "priced", text: "" }] : [];
  }
}

async function notify(webhookUrl: string | undefined, text: string): Promise<boolean> {
  console.log(text);
  if (!webhookUrl) return true;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.ok) return true;
    console.error(`monitor: webhook HTTP ${res.status}`);
  } catch (e) {
    console.error(`monitor: webhook: ${e}`);
  }
  return false;
}
