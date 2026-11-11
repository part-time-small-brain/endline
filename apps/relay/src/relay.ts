import { randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  AccountId,
  CLAIM_WINDOW_SEC,
  type Config as ContractConfig,
  intentsAssetId,
  isListed,
  longTokenId,
  payload,
  type PublishRequest,
  type Quote,
  type QuoteEvent,
  type QuoteRequest,
  type RelayMessage,
  type Series,
  type SeriesListing,
  type SignedPayload,
  type StatusUpdate,
  tokenDiff,
  toSign,
} from "@endline/sdk";
import type { z } from "zod";
import { type Auctions, MAX_WAIT_MS } from "./auction.ts";
import { type Bid, legs } from "./bid.ts";
import type { Config } from "./config.ts";
import type { Fills } from "./fills.ts";
import { rateLimit } from "./limit.ts";
import { type Chain, ranTx } from "./rpc.ts";
import { Sessions } from "./session.ts";

export const SIGN_MARGIN_MS = 3_000;
const FORGET_AFTER_MS = 60 * 60_000;
const QUOTES_PER_SIGNER = 4;
const QUOTE_WINDOW_MS = 25_000;

const failed = (quoteId: string, error: unknown): StatusUpdate => ({ quote_id: quoteId, status: "failed", reason: error instanceof Error ? error.message : String(error) });

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MarketMakers {
  ids(): string[];
  send(mmId: string, message: z.infer<typeof RelayMessage>): void;
}

interface Issued {
  quote: Quote;
  signerId: string;
  bid: Bid;
  status: StatusUpdate;
  giveBack: () => void;
}

interface Hold {
  signerId: string;
  asset: string;
  amount: bigint;
}

interface RelayDeps {
  config: Pick<Config, "intents_id" | "options_id" | "quote_asset">;
  chain: Chain;
  fills: Fills;
  auctions: Auctions;
  mms: MarketMakers;
}

export const listed = (series: Series, contract: ContractConfig) => isListed(series, contract.quote_decimals);
export const open = (series: Series, contract: ContractConfig) => Date.now() < (series.expiry - contract.timing.write_cutoff_sec) * 1000;

export class Relay {
  private issued = new Map<string, Issued>();
  private quoting: Hold[] = [];
  readonly sessions: Sessions;
  private signerQuotes = rateLimit(QUOTES_PER_SIGNER, QUOTE_WINDOW_MS);

  constructor(private deps: RelayDeps) {
    this.sessions = new Sessions(deps.chain, deps.config.intents_id);
  }

  async series(): Promise<SeriesListing> {
    const { chain, config } = this.deps;
    const [all, contract] = await Promise.all([chain.listSeries(), chain.contractConfig()]);
    const oldest = Date.now() / 1000 - CLAIM_WINDOW_SEC;
    return {
      quote_asset: config.quote_asset,
      quote_decimals: contract.quote_decimals,
      series: all.filter((series) => series.expiry > oldest).map((series) => ({ ...series, option_asset: this.optionAsset(series), quotable: listed(series, contract) && open(series, contract) })),
    };
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    const { chain, config, auctions, mms } = this.deps;
    if (!AccountId.safeParse(request.signer.signer_id).success) throw new HttpError(400, "signer_id is not a valid intents account");
    await this.sessions.check(request.session, request.signer);
    const [all, contract] = await Promise.all([chain.listSeries(), chain.contractConfig()]);
    const series = all.find((s) => s.id === request.series_id);
    if (!series) throw new HttpError(404, "unknown series");
    if (!listed(series, contract)) throw new HttpError(409, "no market maker lists this width at this strike");
    if (!open(series, contract)) throw new HttpError(409, "series is close-only: past the write cutoff before expiry");
    if (request.side === "buy" && BigInt(request.size) < (await chain.minWrite(series.underlying))) throw new HttpError(400, "size is below the minimum write size");
    const invited = mms.ids();
    if (invited.length === 0) throw new HttpError(503, "no market makers online");

    const buying = request.side === "buy";
    const asset = buying ? config.quote_asset : this.optionAsset(series);
    // no market maker sells for under $1, so a buyer must hold that much before an auction; the real premium is held after it
    const hold: Hold = { signerId: request.signer.signer_id, asset, amount: buying ? 10n ** BigInt(contract.quote_decimals) : BigInt(request.size) };
    this.quoting.push(hold);
    try {
      await this.reserve(hold, buying ? "a buy needs at least $1 of USDC free in your NEAR Intents balance: deposit first" : undefined);
      const slot = this.signerQuotes(request.signer.signer_id);
      if (!slot) throw new HttpError(429, "too many quotes for this account, try again in a few seconds");
      const [fee, salt] = await Promise.all([chain.fee(), chain.currentSalt()]);
      const { id, ...terms } = series;
      const event: QuoteEvent = {
        quote_id: randomUUID(),
        series_id: id,
        side: request.side,
        size: request.size,
        option_asset: this.optionAsset(series),
        quote_asset: config.quote_asset,
        fee_pips: Number(fee),
        deadline_ms: Date.now() + MAX_WAIT_MS,
        terms,
      };
      const auction = auctions.run(event, invited);
      for (const mmId of invited) mms.send(mmId, { method: "quote", params: event });
      const bid = await auction;
      if (!bid) throw new HttpError(503, "no valid quotes from market makers");
      if (buying) hold.amount = bid.premium;
      await this.reserve(hold).catch((error: unknown) => {
        mms.send(bid.mmId, { method: "quote_status", params: { quote_id: event.quote_id, status: "expired" } });
        throw error;
      });

      const signByMs = bid.deadlineMs - SIGN_MARGIN_MS;
      const userLeg = legs(event, bid.premium).user;
      const userPayload = payload(config.intents_id, request.signer.signer_id, bid.deadlineMs, salt, randomBytes(15), [tokenDiff(userLeg)]);
      const premium = bid.premium.toString();
      const option = { asset: event.option_asset, amount: request.size };
      const cash = { asset: event.quote_asset, amount: premium };
      const quote: Quote = {
        quote_id: event.quote_id,
        series_id: id,
        side: request.side,
        size: request.size,
        premium,
        pay: buying ? cash : option,
        receive: buying ? option : cash,
        sign_by_ms: signByMs,
        payload: toSign(request.signer.standard, userPayload),
      };
      this.forgetOld();
      const entry: Issued = { quote, signerId: request.signer.signer_id, bid, status: { quote_id: quote.quote_id, status: "open" }, giveBack: slot };
      for (const other of this.issued.values()) if (other.signerId === entry.signerId) this.expire(other);
      this.issued.set(quote.quote_id, entry);
      setTimeout(() => this.expire(entry), signByMs - Date.now());
      return quote;
    } finally {
      this.quoting.splice(this.quoting.indexOf(hold), 1);
    }
  }

  async publish(request: PublishRequest): Promise<StatusUpdate> {
    const entry = this.entry(request.quote_id);
    if (entry.status.status === "expired" || Date.now() > entry.quote.sign_by_ms) throw new HttpError(410, "quote expired");
    if (entry.status.status !== "open") throw new HttpError(409, `quote is already ${entry.status.status}`);
    const { standard, payload: signedPayload } = request.signed;
    if (!isDeepStrictEqual({ standard, payload: signedPayload }, entry.quote.payload)) throw new HttpError(400, "signed payload differs from the issued one");

    entry.status = { quote_id: request.quote_id, status: "settling" };
    entry.status = await this.settle(request.quote_id, entry.bid.signed, request.signed);
    this.deps.mms.send(entry.bid.mmId, { method: "quote_status", params: entry.status });
    if (entry.status.status === "settled") {
      entry.giveBack();
      await this.recordFill(entry, entry.status.tx_hash ?? "");
    }
    return entry.status;
  }

  status(quoteId: string): StatusUpdate {
    return this.entry(quoteId).status;
  }

  private entry(quoteId: string): Issued {
    const entry = this.issued.get(quoteId);
    if (!entry) throw new HttpError(404, "unknown quote");
    return entry;
  }

  private async settle(quoteId: string, mm: SignedPayload, user: SignedPayload): Promise<StatusUpdate> {
    const batch = [mm, user];
    try {
      const { invariant_violated } = await this.deps.chain.simulate(batch);
      if (invariant_violated !== undefined) throw new Error(`unbalanced batch: ${JSON.stringify(invariant_violated)}`);
    } catch (error) {
      return failed(quoteId, error);
    }
    try {
      return { quote_id: quoteId, status: "settled", tx_hash: await this.deps.chain.execute(batch) };
    } catch (error) {
      console.error("execute_intents errored, settling by the relayer's transactions", quoteId, error);
      const txHash = await ranTx(this.deps.chain, user, error, quoteId);
      return txHash === undefined ? failed(quoteId, error) : { quote_id: quoteId, status: "settled", tx_hash: txHash };
    }
  }

  private async recordFill({ quote, signerId }: Issued, txHash: string): Promise<void> {
    const fill = {
      quote_id: quote.quote_id,
      series_id: quote.series_id,
      side: quote.side,
      account_id: signerId,
      size: quote.size,
      premium: quote.premium,
      tx_hash: txHash,
      at_ms: Date.now(),
    };
    await this.deps.fills.append(fill).catch((error) => console.error("fill not recorded", fill, error));
  }

  private expire(entry: Issued): void {
    if (entry.status.status !== "open") return;
    entry.status = { quote_id: entry.quote.quote_id, status: "expired" };
    this.deps.mms.send(entry.bid.mmId, { method: "quote_status", params: entry.status });
  }

  private async reserve({ signerId, asset }: Hold, refusal = "your balance doesn't cover this quote: deposit first"): Promise<void> {
    const balance = await this.deps.chain.balanceOf(signerId, asset);
    const settling = [...this.issued.values()].filter((entry) => entry.status.status === "settling");
    const holds = [...this.quoting, ...settling.map(({ signerId, quote }) => ({ signerId, asset: quote.pay.asset, amount: BigInt(quote.pay.amount) }))];
    const held = holds.reduce((sum, hold) => (hold.signerId === signerId && hold.asset === asset ? sum + hold.amount : sum), 0n);
    if (held > balance) throw new HttpError(402, refusal);
  }

  private optionAsset(series: Series): string {
    return intentsAssetId(this.deps.config.options_id, longTokenId(series.id));
  }

  private forgetOld(): void {
    for (const [id, entry] of this.issued) {
      if (entry.quote.sign_by_ms < Date.now() - FORGET_AFTER_MS) this.issued.delete(id);
    }
  }
}
