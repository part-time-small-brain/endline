import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { z } from "zod";

export const DEPOSIT_ORIGIN = /^(nep141|nep245):/;
const ONE_CLICK_KEY = base58.decode("reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc");
const SIGNED_FIELDS = ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"];
const SIGNED_IF_SET = ["depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"];
const Fields = z.record(z.string(), z.unknown());
const SignedQuote = z.object({ quote: Fields, signature: z.string(), timestamp: z.string() });

const ifSet = (fields: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((key) => [key, fields[key] || undefined]));
const utf8 = (text: string) => new TextEncoder().encode(text);

// The 1Click SDK's verifyQuoteSignature, with every request field taken from the request we sent, never from 1Click's echo of it.
export function verifyDepositQuote(request: Record<string, unknown>, response: unknown): boolean {
  const signed = SignedQuote.safeParse(response).data;
  if (!signed) return false;
  const { quote, signature, timestamp } = signed;
  const message = {
    ...request,
    ...Object.fromEntries(SIGNED_FIELDS.map((key) => [key, quote[key]])),
    ...ifSet(quote, SIGNED_IF_SET),
    timestamp,
  };
  try {
    const digest = base58.encode(sha256(utf8(JSON.stringify(message, Object.keys(message).sort()))));
    return ed25519.verify(base58.decode(signature.replace(/^ed25519:/, "")), utf8(digest), ONE_CLICK_KEY);
  } catch {
    return false;
  }
}
