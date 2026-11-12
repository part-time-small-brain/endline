import { setTimeout as sleep } from "node:timers/promises";
import type { Series } from "@endline/sdk";
import { Account, type KeyPairString, teraToGas } from "near-api-js";
import { ChainReader } from "./chain.ts";
import type { SettlerConfig } from "./config.ts";
import { due } from "./propose.ts";

const TICK_MS = 60_000;
const SETTLE_DELAY_SEC = 300;
const RETRY_SEC = 600;
const SETTLE_DEPOSIT = 10_000_000_000_000_000_000_000n;

export function requests(series: Series[], proposed: Set<string>, requested: Map<string, number>, nowSec: number, oracleWindowSec: number): { underlying: string; expiry: number }[] {
  return due(series, proposed, nowSec, SETTLE_DELAY_SEC, oracleWindowSec).filter(({ underlying, expiry }) => {
    const last = requested.get(`${underlying} ${expiry}`);
    return last === undefined || nowSec >= last + RETRY_SEC;
  });
}

class SettlerChain extends ChainReader {
  private readonly account: Account;

  constructor(config: SettlerConfig) {
    super(config.rpc, config.optionsId);
    this.account = new Account(config.accountId, this.provider, config.privateKey as KeyPairString);
  }

  async request(underlying: string, expiry: number): Promise<void> {
    await this.account.callFunctionRaw({
      contractId: this.optionsId,
      methodName: "request_settlement",
      args: { underlying, expiry },
      gas: teraToGas(300),
      deposit: SETTLE_DEPOSIT,
      waitUntil: "INCLUDED_FINAL",
    });
  }
}

export async function settleCommand(config: SettlerConfig, once: boolean): Promise<void> {
  const chain = new SettlerChain(config);
  const network = await chain.networkId();
  if (network !== "mainnet") throw new Error(`settle runs on mainnet only, RPC is on ${network}: testnet settles through propose`);
  const proposed = new Set<string>();
  const requested = new Map<string, number>();
  const sent = new Set<string>();
  for (;;) {
    try {
      const terms = await chain.settlementTerms();
      const nowSec = Math.floor(Date.now() / 1000);
      const series = await chain.seriesFrom(nowSec - terms.oracleWindowSec);
      for (const { underlying, expiry } of requests(series, proposed, requested, nowSec, terms.oracleWindowSec)) {
        const key = `${underlying} ${expiry}`;
        if (await chain.settlement(underlying, expiry)) {
          proposed.add(key);
          continue;
        }
        if (sent.delete(key)) console.error(`settle: ${key}: no price 10 min after the last request (OutLayer failed or the contract logged "settlement rejected"), requesting again`);
        requested.set(key, nowSec);
        try {
          await chain.request(underlying, expiry);
          sent.add(key);
          console.log(`settle: ${key}: sent request_settlement`);
        } catch (e) {
          console.error(`settle: ${key}: ${e}`);
        }
      }
    } catch (e) {
      console.error(`settle: ${e}`);
    }
    if (once) return;
    await sleep(TICK_MS);
  }
}
