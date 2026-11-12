import { Config, Settlement, type Timing } from "@endline/sdk";
import { z } from "zod";
import type { SettlementView } from "../lib/status.ts";

export interface ContractTerms {
  timing: Timing;
  quoteDecimals: number;
  decimals: Record<string, number>;
}

const RPC_TIMEOUT_MS = 5_000;

type RpcAnswer = { result?: { result?: number[]; error?: string } };

const Underlyings = z.array(z.tuple([z.string(), z.object({ decimals: z.number().int() })]));

export interface Chain {
  contract(): Promise<ContractTerms>;
  balances(accountId: string, assets: string[]): Promise<Record<string, bigint>>;
  settlement(underlying: string, expiry: number): Promise<SettlementView | null>;
  salt(): Promise<Uint8Array>;
  hasPublicKey(accountId: string, publicKey: string): Promise<boolean>;
}

export function rpcChain(rpcUrls: string[], intentsId: string, optionsId: string): Chain {
  async function view(contract: string, method: string, args: object): Promise<unknown> {
    for (const url of rpcUrls) {
      const answer = await ask(url, contract, method, args).catch(() => undefined);
      if (answer?.result) {
        if (!answer.result.result) throw new Error(answer.result.error ?? `${method} failed`);
        return JSON.parse(new TextDecoder().decode(new Uint8Array(answer.result.result)));
      }
    }
    throw new Error("NEAR isn't answering right now. Trying again in a minute.");
  }

  async function ask(url: string, contract: string, method: string, args: object): Promise<RpcAnswer> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "web",
        method: "query",
        params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) },
      }),
    });
    return (await response.json()) as RpcAnswer;
  }

  return {
    async contract() {
      const [config, underlyings] = await Promise.all([view(optionsId, "get_config", {}), view(optionsId, "get_underlyings", {})]);
      const { timing, quote_decimals } = Config.parse(config);
      return { timing, quoteDecimals: quote_decimals, decimals: Object.fromEntries(Underlyings.parse(underlyings).map(([symbol, { decimals }]) => [symbol, decimals])) };
    },
    async balances(accountId, assets) {
      const amounts = z.array(z.string()).parse(await view(intentsId, "mt_batch_balance_of", { account_id: accountId, token_ids: assets }));
      return Object.fromEntries(assets.map((asset, i) => [asset, BigInt(amounts[i] ?? "0")]));
    },
    async settlement(underlying, expiry) {
      const settlement = Settlement.nullable().parse(await view(optionsId, "get_settlement", { underlying, expiry }));
      return settlement && { price: BigInt(settlement.price), finalAt: settlement.final_at };
    },
    async salt() {
      const hex = z.string().regex(/^[0-9a-f]{8}$/).parse(await view(intentsId, "current_salt", {}));
      return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
    },
    async hasPublicKey(accountId, publicKey) {
      return z.boolean().parse(await view(intentsId, "has_public_key", { account_id: accountId, public_key: publicKey }));
    },
  };
}
