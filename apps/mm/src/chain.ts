import { randomBytes } from "node:crypto";
import { Config as ConfigView, type Intent, type OptionKind, payload, Series, Settlement } from "@endline/sdk";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { Underlying } from "./market.ts";
import { nep413Signer, type SignPayload } from "./signer.ts";

const Underlyings = z.array(
  z.tuple([z.string(), z.object({ index: z.string(), decimals: z.number().int().min(0).max(24), min_write: z.string().regex(/^[0-9]+$/).transform(BigInt) })]),
);
const Balances = z.array(z.string().regex(/^[0-9]+$/).transform(BigInt));
const Salt = z.string().regex(/^[0-9a-f]{8}$/);
const Fee = z.number().int().min(0).max(999_999);
const Simulation = z.object({ invariant_violated: z.unknown().optional() }).loose();
const SERIES_PAGE = 200;
const SettlementTermsView = ConfigView.extend({ owner_id: z.string(), timing: z.object({ oracle_window_sec: z.number().int().min(0) }) });
const SettlementView = Settlement.extend({ proposed_by: z.string() });
const PendingOwnerView = z.object({ pending_owner_id: z.string().nullable() });
const PendingOracleChangesView = z.object({
  oracles: z.array(z.tuple([z.string(), z.number().int()])),
  oracle_wasm: z.object({ oracle_wasm: z.object({ outlayer_id: z.string(), url: z.string(), sha256: z.string() }), active_at: z.number().int() }).nullable(),
});
const ListingTermsView = ConfigView.extend({
  paused: z.boolean(),
  timing: z.object({ period_sec: z.number().int().positive(), offset_sec: z.number().int().min(0), write_cutoff_sec: z.number().int().min(0), max_horizon_sec: z.number().int().min(0) }),
});

export interface ContractConfig {
  quoteAsset: string;
  quoteDecimals: number;
  writeCutoffSec: number;
}

export interface SettlementTerms {
  ownerId: string;
  oracles: string[];
  quoteDecimals: number;
  oracleWindowSec: number;
}

export interface ListingTerms {
  quoteAsset: string;
  quoteDecimals: number;
  periodSec: number;
  offsetSec: number;
  writeCutoffSec: number;
  maxHorizonSec: number;
  paused: boolean;
}

export type ProposedSettlement = z.infer<typeof SettlementView>;
export type PendingChanges = z.infer<typeof PendingOracleChangesView> & z.infer<typeof PendingOwnerView>;

export interface IntentsState {
  fee: bigint;
  salt: Uint8Array;
}

export class ChainReader {
  protected readonly provider: JsonRpcProvider;

  constructor(rpcUrl: string, protected readonly optionsId: string) {
    this.provider = new JsonRpcProvider({ url: rpcUrl });
  }

  networkId(): Promise<string> {
    return this.provider.getNetworkId();
  }

  protected async view(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.provider.callFunction({ contractId, method, args });
  }

  async contractConfig(): Promise<ContractConfig> {
    const c = ConfigView.parse(await this.view(this.optionsId, "get_config"));
    return { quoteAsset: c.quote_asset, quoteDecimals: c.quote_decimals, writeCutoffSec: c.timing.write_cutoff_sec };
  }

  async listingTerms(): Promise<ListingTerms> {
    const c = ListingTermsView.parse(await this.view(this.optionsId, "get_config"));
    const t = c.timing;
    return {
      quoteAsset: c.quote_asset,
      quoteDecimals: c.quote_decimals,
      periodSec: t.period_sec,
      offsetSec: t.offset_sec,
      writeCutoffSec: t.write_cutoff_sec,
      maxHorizonSec: t.max_horizon_sec,
      paused: c.paused,
    };
  }

  async getSeries(id: string): Promise<Series> {
    const series = Series.nullable().parse(await this.view(this.optionsId, "get_series", { series_id: id }));
    if (!series) throw new Error(`unknown series ${id}`);
    return series;
  }

  async underlyings(): Promise<Underlying[]> {
    const list = Underlyings.parse(await this.view(this.optionsId, "get_underlyings"));
    return list.map(([symbol, u]) => ({ symbol, index: u.index, decimals: u.decimals, minWrite: u.min_write }));
  }

  async series(): Promise<Series[]> {
    const all: Series[] = [];
    for (let from = 0; ; from += SERIES_PAGE) {
      const page = z.array(Series).parse(await this.view(this.optionsId, "list_series", { from_index: from, limit: SERIES_PAGE }));
      all.push(...page);
      if (page.length < SERIES_PAGE) return all;
    }
  }

  async seriesFrom(fromExpiry: number, untilExpiry = Infinity): Promise<Series[]> {
    const all: Series[] = [];
    for (;;) {
      const last = all.at(-1);
      const cursor = last ? { from_expiry: last.expiry, after_id: last.id } : { from_expiry: fromExpiry };
      const page = z.array(Series).parse(await this.view(this.optionsId, "list_series_by_expiry", { ...cursor, limit: SERIES_PAGE }));
      all.push(...page);
      if (page.length < SERIES_PAGE || (page.at(-1)?.expiry ?? 0) > untilExpiry) return all.filter((s) => s.expiry <= untilExpiry);
    }
  }

  async deletableSeries(ids: string[]): Promise<string[]> {
    return z.array(z.string()).parse(await this.view(this.optionsId, "deletable_series", { series_ids: ids }));
  }

  async settlementTerms(): Promise<SettlementTerms> {
    const [config, oracles] = await Promise.all([this.view(this.optionsId, "get_config"), this.view(this.optionsId, "get_oracles")]);
    const c = SettlementTermsView.parse(config);
    return { ownerId: c.owner_id, oracles: z.array(z.string()).parse(oracles), quoteDecimals: c.quote_decimals, oracleWindowSec: c.timing.oracle_window_sec };
  }

  async settlement(underlying: string, expiry: number): Promise<ProposedSettlement | null> {
    return SettlementView.nullable().parse(await this.view(this.optionsId, "get_settlement", { underlying, expiry }));
  }

  async pendingChanges(): Promise<PendingChanges> {
    const [config, changes] = await Promise.all([this.view(this.optionsId, "get_config"), this.view(this.optionsId, "get_pending_oracle_changes")]);
    return { ...PendingOracleChangesView.parse(changes), ...PendingOwnerView.parse(config) };
  }

  async nearBalance(accountId: string): Promise<{ amount: bigint; storageUsage: number }> {
    const account = await this.provider.viewAccount({ accountId });
    return { amount: account.amount, storageUsage: account.storage_usage };
  }
}

export class Chain extends ChainReader {
  private readonly account: Account;
  private readonly sign: SignPayload;

  constructor(private readonly config: Config) {
    super(config.rpcUrl, config.optionsId);
    this.account = new Account(config.accountId, this.provider, config.privateKey);
    this.sign = nep413Signer(config.accountId, config.privateKey);
  }

  async intentsState(): Promise<IntentsState> {
    const [fee, salt] = await Promise.all([this.view(this.config.intentsId, "fee"), this.view(this.config.intentsId, "current_salt")]);
    return { fee: BigInt(Fee.parse(fee)), salt: Uint8Array.from(Buffer.from(Salt.parse(salt), "hex")) };
  }

  async balances(assets: string[]): Promise<Map<string, bigint>> {
    const raw = await this.view(this.config.intentsId, "mt_batch_balance_of", { account_id: this.config.accountId, token_ids: assets });
    const amounts = Balances.length(assets.length).parse(raw);
    return new Map(assets.map((asset, i) => [asset, amounts[i] ?? 0n]));
  }

  async execute(signed: unknown[]): Promise<string> {
    const simulation = Simulation.parse(await this.view(this.config.intentsId, "simulate_intents", { signed }));
    if (simulation.invariant_violated !== undefined) throw new Error(`simulation failed: ${JSON.stringify(simulation.invariant_violated)}`);
    const outcome = await this.account.callFunctionRaw({
      contractId: this.config.intentsId,
      methodName: "execute_intents",
      args: { signed },
      gas: teraToGas(300),
    });
    return outcome.transaction.hash;
  }

  async submit(intent: Intent, deadlineMs: number): Promise<string> {
    const { salt } = await this.intentsState();
    const signed = await this.sign(payload(this.config.intentsId, this.config.accountId, deadlineMs, salt, randomBytes(15), [intent]));
    return this.execute([signed]);
  }

  async createSeries(underlying: string, strike: bigint, width: bigint, expiry: number, kind: OptionKind, deposit: bigint): Promise<string> {
    const outcome = await this.account.callFunctionRaw({
      contractId: this.optionsId,
      methodName: "create_series",
      args: { underlying, strike: strike.toString(), width: width.toString(), expiry, kind },
      gas: teraToGas(30),
      deposit,
    });
    return outcome.transaction.hash;
  }

  async deleteSeries(ids: string[]): Promise<string> {
    const outcome = await this.account.callFunctionRaw({
      contractId: this.optionsId,
      methodName: "delete_series",
      args: { series_ids: ids },
      gas: teraToGas(300),
      deposit: 0n,
    });
    return outcome.transaction.hash;
  }
}
