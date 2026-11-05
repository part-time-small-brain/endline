import type { Payload, Quote } from "@near-options/sdk";

const MAX_DEADLINE_SLACK_MS = 5_000;

export interface Expected {
  signerId: string;
  intentsId: string;
  optionAsset: string;
  quoteAsset: string;
  side: Quote["side"];
  size: string;
}

export interface Leg {
  asset: string;
  amount: bigint;
}

export function checkTrade(message: Payload, quote: Quote, expected: Expected): { pay: Leg; receive: Leg } {
  const fail = (reason: string): never => {
    throw new Error(`Quote doesn't match what you asked for (${reason}). Nothing was signed.`);
  };
  if (message.signer_id !== expected.signerId) fail("signer");
  if (message.verifying_contract !== expected.intentsId) fail("contract");
  if (!(Date.parse(message.deadline) <= quote.sign_by_ms + MAX_DEADLINE_SLACK_MS)) fail("deadline");
  if (quote.side !== expected.side || quote.size !== expected.size) fail("size");

  const cash = { asset: expected.quoteAsset, amount: BigInt(quote.premium) };
  const option = { asset: expected.optionAsset, amount: BigInt(expected.size) };
  const [pay, receive] = expected.side === "buy" ? [cash, option] : [option, cash];
  if (quote.pay.asset !== pay.asset || BigInt(quote.pay.amount) !== pay.amount) fail("pay");
  if (quote.receive.asset !== receive.asset || BigInt(quote.receive.amount) !== receive.amount) fail("receive");

  const [intent, ...extra] = message.intents;
  if (intent?.intent !== "token_diff" || extra.length > 0) return fail("diff");
  const diff = intent.diff;
  if (Object.keys(diff).length !== 2 || diff[pay.asset] !== (-pay.amount).toString() || diff[receive.asset] !== receive.amount.toString()) fail("diff");
  return { pay, receive };
}
