import { Amount, CLAIM_WINDOW_SEC, Config as ContractConfig, readPayload, Series, Settlement, type SignedPayload } from "@near-options/sdk";
import { Account, getTransactionLastResult, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { z } from "zod";
import type { Config } from "./config.ts";

const CACHE_MS = 60_000;
const EXECUTE_GAS = 300_000_000_000_000n;
const FT_TRANSFER_CALL_GAS = 100_000_000_000_000n;
const PAGE = 200;
const NONCE_POLL_MS = 3_000;
const NONCE_FINAL_MS = 5_000;

const Simulation = z.object({ invariant_violated: z.unknown().optional() });
type Simulation = z.infer<typeof Simulation>;

export class Rejected extends Error {}
export class Refunded extends Error {}

export interface Chain {
  fee(): Promise<bigint>;
  currentSalt(): Promise<Uint8Array>;
  listSeries(): Promise<Series[]>;
  contractConfig(): Promise<ContractConfig>;
  settlement(underlying: string, expiry: number): Promise<Settlement | null>;
  minWrite(underlying: string): Promise<bigint>;
  balanceOf(accountId: string, asset: string): Promise<bigint>;
  simulate(signed: SignedPayload[]): Promise<Simulation>;
  execute(signed: SignedPayload[]): Promise<string>;
  isNonceUsed(accountId: string, nonce: string): Promise<boolean>;
  finalTimeMs(): Promise<number>;
}

// an execute error can come back for a batch that ran; only a final block past the deadline with the nonce unused means it never will
export async function ranByNonce(chain: Chain, signed: SignedPayload, label: string): Promise<boolean> {
  const { signer_id, nonce, deadline } = readPayload(signed);
  const final = Date.parse(deadline) + NONCE_FINAL_MS;
  let logged = false;
  for (;;) {
    try {
      const past = (await chain.finalTimeMs()) > final;
      if (await chain.isNonceUsed(signer_id, nonce)) return true;
      if (past) return false;
    } catch (readError) {
      if (!logged) console.error("can't read the user's nonce yet, still settling", label, readError);
      logged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, NONCE_POLL_MS));
  }
}

function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let entry: { value: Promise<T>; at: number } | undefined;
  return () => {
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      const last = entry?.value;
      const value = last
        ? load().catch((error: unknown) => {
            console.error("rpc refresh failed, serving the last value", error);
            return last;
          })
        : load();
      entry = { value, at: Date.now() };
      value.catch(() => {
        if (entry?.value === value) entry = undefined;
      });
    }
    return entry.value;
  };
}

interface NearChain extends Chain {
  networkId(): Promise<string>;
  depositFt(token: string, accountId: string, amount: bigint): Promise<string>;
}

export function nearChain(config: Config): NearChain {
  const provider = new JsonRpcProvider({ url: config.NEAR_RPC_URL });
  const relayer = new Account(config.RELAYER_ACCOUNT_ID, provider, config.RELAYER_PRIVATE_KEY as KeyPairString);
  const view = (contractId: string, method: string, args: Record<string, unknown> = {}) =>
    provider.callFunction({ contractId, method, args });

  const listSeries = async () => {
    const fromExpiry = Math.floor(Date.now() / 1000) - CLAIM_WINDOW_SEC;
    const all: Series[] = [];
    for (;;) {
      const last = all.at(-1);
      const cursor = last ? { from_expiry: last.expiry, after_id: last.id } : { from_expiry: fromExpiry };
      const page = z.array(Series).parse(await view(config.OPTIONS_ID, "list_series_by_expiry", { ...cursor, limit: PAGE }));
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  };

  const minWrites = cached(async () => {
    const list = z.array(z.tuple([z.string(), z.object({ min_write: Amount })])).parse(await view(config.OPTIONS_ID, "get_underlyings"));
    return new Map(list.map(([symbol, { min_write }]) => [symbol, BigInt(min_write)]));
  });

  return {
    networkId: () => provider.getNetworkId(),
    depositFt: async (token, accountId, amount) => {
      const outcome = await relayer.callFunctionRaw({
        contractId: token,
        methodName: "ft_transfer_call",
        args: { receiver_id: config.INTENTS_ID, amount: amount.toString(), msg: accountId },
        gas: FT_TRANSFER_CALL_GAS,
        deposit: 1n,
      });
      // a refused deposit still succeeds: the token refunds us and ft_transfer_call returns the amount used
      const used = getTransactionLastResult(outcome);
      if (used === "0") throw new Refunded(`${accountId} was not credited`);
      if (used !== amount.toString()) throw new Error(`unexpected ft_transfer_call result for ${accountId}: ${JSON.stringify(outcome.status)}`);
      return outcome.transaction_outcome.id;
    },
    fee: cached(async () => BigInt(z.number().int().parse(await view(config.INTENTS_ID, "fee")))),
    currentSalt: cached(async () => {
      const hex = z.string().regex(/^[0-9a-f]{8}$/).parse(await view(config.INTENTS_ID, "current_salt"));
      return Uint8Array.from(Buffer.from(hex, "hex"));
    }),
    listSeries: cached(listSeries),
    contractConfig: cached(async () => ContractConfig.parse(await view(config.OPTIONS_ID, "get_config"))),
    settlement: async (underlying, expiry) => Settlement.nullable().parse(await view(config.OPTIONS_ID, "get_settlement", { underlying, expiry })),
    minWrite: async (underlying) => {
      const min = (await minWrites()).get(underlying);
      if (min === undefined) throw new Error(`unknown underlying ${underlying}`);
      return min;
    },
    balanceOf: async (accountId, asset) => BigInt(z.string().regex(/^[0-9]+$/).parse(await view(config.INTENTS_ID, "mt_balance_of", { account_id: accountId, token_id: asset }))),
    simulate: async (signed) => {
      const result = await view(config.INTENTS_ID, "simulate_intents", { signed }).catch((error: unknown) => {
        // near-api-js reports the verifier refusing a payload as a view-call GuestPanic
        if (error instanceof Error && error.message.includes("GuestPanic")) throw new Rejected(error.message);
        throw error;
      });
      return Simulation.parse(result);
    },
    execute: async (signed) => {
      const outcome = await relayer.callFunctionRaw({
        contractId: config.INTENTS_ID,
        methodName: "execute_intents",
        args: { signed },
        gas: EXECUTE_GAS,
        deposit: 0n,
      });
      return outcome.transaction_outcome.id;
    },
    isNonceUsed: async (accountId, nonce) => z.boolean().parse(await provider.callFunction({ contractId: config.INTENTS_ID, method: "is_nonce_used", args: { account_id: accountId, nonce }, blockQuery: { finality: "final" } })),
    finalTimeMs: async () => Number(BigInt((await provider.viewBlock({ finality: "final" })).header.timestamp_nanosec) / 1_000_000n),
  };
}
