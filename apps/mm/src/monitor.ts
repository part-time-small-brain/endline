import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type Alert, dedupe, MISSING_GRACE_SEC, pendingAlerts, reserveAlert, settlementAlert } from "./alerts.ts";
import { ChainReader } from "./chain.ts";
import type { MonitorConfig } from "./config.ts";
import { settlementReferences } from "./deribit.ts";

const CONTRACT_RESERVE_YOCTO = 3n * 10n ** 23n;
const ACCOUNT_RESERVE_YOCTO = 2n * 10n ** 24n;

const TICK_MS = 60_000;
const HTTP_TIMEOUT_MS = 5_000;
const BRIEF = new Set(["uptime", "quotes", "priced"]);
const Health = z.object({ ok: z.literal(true), market_makers: z.number() });
const Marks = z.array(z.unknown());

interface Opened {
  title: string;
  at: number;
  messageId?: number | undefined;
}

export async function monitorCommand(config: MonitorConfig, once: boolean): Promise<void> {
  const chain = new ChainReader(config.rpcUrl, config.optionsId);
  const final = new Set<string>();
  const open = new Map<string, Opened>();
  const net = config.networkId;
  let seen = new Set<string>();
  for (;;) {
    try {
      const alerts = await check(chain, config, final, open);
      const { fresh, resolved } = dedupe(new Set(open.keys()), alerts);
      const lasting = fresh.filter((a) => !BRIEF.has(a.key) || seen.has(a.key));
      seen = new Set(alerts.map((a) => a.key));
      for (const alert of lasting) {
        const sent = await notify(config.webhookUrl, `ALERT [${net}] ${alert.title}: ${alert.text}`, `🔴 ${net} · ${alert.title}\n${alert.text}`);
        if (!sent) continue;
        open.set(alert.key, { title: alert.title, at: Date.now(), messageId: sent.messageId });
      }
      for (const key of resolved) {
        const o = open.get(key);
        if (!o) continue;
        const took = duration(Date.now() - o.at);
        const sent = final.has(key.replace(/^settle /, ""))
          ? await notify(config.webhookUrl, `FINAL [${net}] ${o.title}: the flagged price is final now, after ${took}`, `⚠️ ${net} · Final: ${o.title}\nThe flagged price can't be overridden any more. Check it`, o.messageId)
          : await notify(config.webhookUrl, `RESOLVED [${net}] ${o.title}, after ${took}`, `✅ ${net} · Resolved: ${o.title}\nLasted ${took}`, o.messageId);
        if (!sent) continue;
        open.delete(key);
      }
      console.log(`monitor: ${open.size} open alerts`);
    } catch (e) {
      console.error(`monitor: check failed: ${e}`);
    }
    if (once) return;
    await sleep(TICK_MS);
  }
}

async function check(chain: ChainReader, config: MonitorConfig, final: Set<string>, open: ReadonlyMap<string, Opened>): Promise<Alert[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const watched: [string, string | undefined, bigint][] = [
    ["Options contract", config.optionsId, CONTRACT_RESERVE_YOCTO],
    ["Intents contract", config.intentsId, ACCOUNT_RESERVE_YOCTO],
    ["Relayer", config.relayerId, ACCOUNT_RESERVE_YOCTO],
    ["Market maker", config.mmId, ACCOUNT_RESERVE_YOCTO],
  ];
  const accounts = watched.filter((a): a is [string, string, bigint] => a[1] !== undefined);
  const reserves = Promise.all(
    accounts.map(async ([role, id, minYocto]): Promise<Alert | undefined> => {
      try {
        const { amount, storageUsage } = await chain.nearBalance(id);
        return reserveAlert(role, id, amount, storageUsage, minYocto);
      } catch (e) {
        return { key: `reserve ${id}`, title: `Can't read ${role.toLowerCase()} NEAR balance`, text: `${id}: can't read balance: ${e}` };
      }
    }),
  );
  const pending = chain.pendingChanges().then(
    (changes) => pendingAlerts(config.optionsId, changes),
    (e): Alert[] => {
      console.error(`monitor: pending changes: ${e}`);
      const stillOpen = [...open.keys()].filter((key) => key.startsWith("pending")).map(held);
      return stillOpen.length > 0 ? stillOpen : [{ key: "pending", title: "Can't read pending admin changes", text: `${config.optionsId}: can't read pending changes: ${e}` }];
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
    if (!settlement && nowSec < expiry + terms.oracleWindowSec + MISSING_GRACE_SEC) continue;
    const index = indexes.get(underlying);
    const price = index === undefined ? undefined : await reference(index, expiry).catch((e) => {
      console.error(`monitor: deribit ${index}: ${e}`);
      return undefined;
    });
    alerts.push(settlementAlert(contract, { underlying, expiry, settlement, reference: price }, nowSec));
  }
  return [...alerts, ...reserveAlerts, ...pendingChangeAlerts, ...uptimeAlerts].filter((a) => a !== undefined);
}

async function healthAlerts(url: string, open: ReadonlyMap<string, Opened>): Promise<Alert[]> {
  const priced = open.has("priced") ? [held("priced")] : [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = Health.safeParse(await res.json());
    if (!health.success) throw new Error("no ok: true in the body");
    if (health.data.market_makers === 0) return [{ key: "quotes", title: "No market maker connected", text: `${url}: nobody gets a quote. Check the mm service` }, ...priced];
  } catch (e) {
    const quotes = open.has("quotes") ? [held("quotes")] : [];
    return [{ key: "uptime", title: "Relay down", text: `${url}: ${e}` }, ...quotes, ...priced];
  }
  return pricedAlerts(new URL("/marks", url).toString(), open);
}

async function pricedAlerts(url: string, open: ReadonlyMap<string, Opened>): Promise<Alert[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const marks = Marks.parse(await res.json());
    return marks.length > 0 ? [] : [{ key: "priced", title: "Market maker prices nothing", text: `${url}: a market maker is connected but prices nothing. Check the lister's log, Deribit, and the MM's USDC and NEAR` }];
  } catch (e) {
    console.error(`monitor: ${url}: ${e}`);
    return open.has("priced") ? [held("priced")] : [];
  }
}

function held(key: string): Alert {
  return { key, title: "", text: "" };
}

function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

const Sent = z.object({ result: z.object({ message_id: z.number() }) });

async function notify(webhookUrl: string | undefined, line: string, message: string, replyTo?: number): Promise<{ messageId?: number | undefined } | undefined> {
  console.log(line);
  if (!webhookUrl) return {};
  // only Telegram returns a message_id, so only Telegram ever gets reply_parameters
  const reply = replyTo === undefined ? {} : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message, content: message, ...reply }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.ok) return { messageId: Sent.safeParse(await res.json().catch(() => undefined)).data?.result.message_id };
    console.error(`monitor: webhook HTTP ${res.status}`);
  } catch (e) {
    console.error(`monitor: webhook: ${e}`);
  }
  return undefined;
}
