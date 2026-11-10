import { AccountId, verifyDepositQuote } from "@endline/sdk";
import { z } from "zod";
import { parseJson } from "./json.ts";
import { rateLimit } from "./limit.ts";
import { HttpError } from "./relay.ts";

const QUOTE_URL = "https://1click.chaindefuser.com/v0/quote";
const TIMEOUT_MS = 10_000;
const MAX_DEADLINE_MS = 24 * 3_600_000;
const MAX_QUOTES_PER_MINUTE = 60;
const MAX_QUOTES_PER_CLIENT_PER_MINUTE = 3;

const depositQuote = (quoteAsset: string) =>
  z
    .strictObject({
      dry: z.literal(false),
      swapType: z.literal("EXACT_INPUT"),
      slippageTolerance: z.number().int().min(0).max(100),
      originAsset: z.string().startsWith("nep141:"),
      depositType: z.literal("ORIGIN_CHAIN"),
      destinationAsset: z.literal(quoteAsset),
      amount: z.string().regex(/^[1-9][0-9]{0,38}$/),
      refundTo: AccountId,
      refundType: z.literal("INTENTS"),
      recipient: AccountId,
      recipientType: z.literal("INTENTS"),
      deadline: z.iso.datetime().refine((d) => Date.parse(d) > Date.now() && Date.parse(d) <= Date.now() + MAX_DEADLINE_MS, "deadline must be within 24 h"),
    })
    .refine((q) => q.refundTo === q.recipient, { message: "refundTo must be the recipient" });

type DepositQuoteRequest = z.infer<ReturnType<typeof depositQuote>>;

export class OneClick {
  readonly schema: ReturnType<typeof depositQuote>;
  private allow = rateLimit(MAX_QUOTES_PER_MINUTE, 60_000);
  private allowClient = rateLimit(MAX_QUOTES_PER_CLIENT_PER_MINUTE, 60_000);

  constructor(
    quoteAsset: string,
    private apiKey: string | undefined,
  ) {
    this.schema = depositQuote(quoteAsset);
  }

  async quote(body: DepositQuoteRequest, client: string): Promise<unknown> {
    if (!this.allowClient(client)) throw new HttpError(429, "too many deposit quotes from your network, try again in a minute");
    if (!this.allow("all")) throw new HttpError(503, "too many deposit quotes right now, try again in a minute");
    let status: number;
    let text: string;
    try {
      const response = await fetch(QUOTE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { "x-api-key": this.apiKey } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      console.error("1click quote failed", error);
      throw new HttpError(502, "1Click is unreachable, try again");
    }
    const json = parseJson(text);
    const answered = status >= 200 && status < 300;
    if (answered && verifyDepositQuote(body, json)) return json;
    if (status === 400) throw new HttpError(400, z.object({ message: z.string() }).safeParse(json).data?.message ?? "1Click refused the quote");
    console.error(`1click quote: ${answered ? "signature check failed" : `HTTP ${status}`} ${text.slice(0, 200)}`);
    if (status === 429) throw new HttpError(503, "1Click is busy, try again in a minute");
    throw new HttpError(502, "deposits are unavailable right now, try again later");
  }
}
