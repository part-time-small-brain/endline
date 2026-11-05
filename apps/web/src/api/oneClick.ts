import { verifyDepositQuote } from "@endline/sdk";
import { z } from "zod";

const DepositAsset = z.object({ assetId: z.string(), symbol: z.string(), blockchain: z.string(), decimals: z.number().int() });
export type DepositAsset = z.infer<typeof DepositAsset>;

const DepositQuote = z.object({ depositAddress: z.string(), amountIn: z.string(), amountOut: z.string(), timeEstimate: z.number() });
export type DepositQuote = z.infer<typeof DepositQuote>;
const SignedQuote = z.object({ quote: DepositQuote.extend({ amountInUsd: z.string(), amountOutUsd: z.string(), depositMemo: z.string().optional() }) });

const DepositStatus = z.enum(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"]);
export type DepositStatus = z.infer<typeof DepositStatus>;

export interface OneClick {
  assets(): Promise<DepositAsset[]>;
  quote(asset: DepositAsset, amount: bigint, recipient: string, destinationAsset: string): Promise<DepositQuote>;
  status(depositAddress: string): Promise<DepositStatus>;
}

const API = "https://1click.chaindefuser.com/v0";
const SOURCES = new Set(["USDC", "USDT", "ETH", "BTC", "SOL"]);
const QUOTE_DEADLINE_MS = 60 * 60_000;
// 1Click doesn't sign appFees, so a relay could add its own fee; legit routes cost well under this
const MAX_LOSS = 0.03;

const Refusal = z.union([z.object({ message: z.string() }).transform((r) => r.message), z.object({ error: z.string() }).transform((r) => r.error)]);

async function request<T>(schema: z.ZodType<T>, url: string, body?: unknown): Promise<T> {
  const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(url, init);
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(Refusal.safeParse(json).data ?? `deposit service returned ${response.status}`);
  return schema.parse(json);
}

export function oneClick(relayUrl: string): OneClick {
  return {
    async assets() {
      const tokens = await request(z.array(DepositAsset), `${API}/tokens`);
      return tokens.filter((token) => SOURCES.has(token.symbol) && token.assetId.startsWith("nep141:") && token.blockchain !== "near");
    },
    async quote(asset, amount, recipient, destinationAsset) {
      const body = {
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 100,
        originAsset: asset.assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset,
        amount: amount.toString(),
        refundTo: recipient,
        refundType: "INTENTS",
        recipient,
        recipientType: "INTENTS",
        deadline: new Date(Date.now() + QUOTE_DEADLINE_MS).toISOString(),
      };
      const signed = await request(z.unknown(), new URL("/deposit-quote", relayUrl).toString(), body);
      const unchecked = new Error("The deposit quote failed its signature check, so it isn't shown.");
      const parsed = SignedQuote.safeParse(signed).data?.quote;
      if (!parsed) throw unchecked;
      const { amountInUsd, amountOutUsd, depositMemo, ...quote } = parsed;
      if (depositMemo) throw new Error("This deposit needs a memo the app doesn't show, so it isn't shown.");
      if (!(Number(amountInUsd) > 0 && Number(amountOutUsd) >= Number(amountInUsd) * (1 - MAX_LOSS))) throw new Error("This deposit would lose more than 3% on the way, so it isn't shown.");
      if (!verifyDepositQuote(body, signed)) throw unchecked;
      return quote;
    },
    async status(depositAddress) {
      return (await request(z.object({ status: DepositStatus }), `${API}/status?depositAddress=${encodeURIComponent(depositAddress)}`)).status;
    },
  };
}
