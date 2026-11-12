import { verifyDepositQuote } from "@endline/sdk";
import { z } from "zod";

export const DepositAsset = z.object({ assetId: z.string(), symbol: z.string(), blockchain: z.string(), decimals: z.number().int(), price: z.number() });
export type DepositAsset = z.infer<typeof DepositAsset>;

const Units = z.string().regex(/^\d+$/);
export const DepositQuote = z.object({
  depositAddress: z.string(),
  amountIn: Units,
  amountOut: Units,
  timeEstimate: z.number(),
  sendBefore: z.iso.datetime(),
  deadline: z.iso.datetime(),
  clockOffsetMs: z.number(),
});
export type DepositQuote = z.infer<typeof DepositQuote>;
const SignedQuote = z.object({
  quote: DepositQuote.pick({ depositAddress: true, amountIn: true, amountOut: true, timeEstimate: true }).extend({ amountInUsd: z.string(), amountOutUsd: z.string(), depositMemo: z.string().optional() }),
  timestamp: z.iso.datetime(),
});

const DepositStatus = z.enum(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS", "INCOMPLETE_DEPOSIT", "REFUNDED", "FAILED"]);
export type DepositStatus = z.infer<typeof DepositStatus>;

export interface OneClick {
  assets(): Promise<DepositAsset[]>;
  quote(asset: DepositAsset, amount: bigint, recipient: string, destinationAsset: string): Promise<DepositQuote>;
  status(depositAddress: string): Promise<DepositStatus>;
}

const API = "https://1click.chaindefuser.com/v0";
export const DEPOSIT_SYMBOLS = ["USDC", "USDT", "ETH", "BTC", "SOL"];
export const MAX_DEPOSIT_UNITS = 10n ** 39n - 1n;
const SEND_WINDOW_MS = 60 * 60_000;
const QUOTE_DEADLINE_MS = 3 * SEND_WINDOW_MS;
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
      const tokens = (await request(z.array(z.unknown()), `${API}/tokens`)).flatMap((token) => DepositAsset.safeParse(token).data ?? []);
      return tokens.filter((token) => DEPOSIT_SYMBOLS.includes(token.symbol) && token.assetId.startsWith("nep141:") && token.blockchain !== "near");
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
      const parsed = SignedQuote.safeParse(signed).data;
      if (!parsed) throw unchecked;
      const { amountInUsd, amountOutUsd, depositMemo, ...quote } = parsed.quote;
      if (depositMemo) throw new Error("This deposit needs a memo the app doesn't show, so it isn't shown.");
      if (!(Number(amountInUsd) > 0 && Number(amountOutUsd) >= Number(amountInUsd) * (1 - MAX_LOSS))) throw new Error("This deposit would lose more than 3% on the way, so it isn't shown.");
      if (!verifyDepositQuote(body, signed)) throw unchecked;
      const quotedAt = Date.parse(parsed.timestamp);
      // a slow device clock shortens the deadline we sent, so still leave an hour before refunds start
      const sendBefore = Math.min(quotedAt + SEND_WINDOW_MS, Date.parse(body.deadline) - SEND_WINDOW_MS);
      return { ...quote, sendBefore: new Date(sendBefore).toISOString(), deadline: body.deadline, clockOffsetMs: quotedAt - Date.now() };
    },
    async status(depositAddress) {
      return (await request(z.object({ status: DepositStatus.catch("PENDING_DEPOSIT") }), `${API}/status?depositAddress=${encodeURIComponent(depositAddress)}`)).status;
    },
  };
}
