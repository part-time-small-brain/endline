import { z } from "zod";
import type { Diff } from "./fees.ts";

const NONCE_MAGIC = [0x56, 0x28, 0xf6, 0xc6];
const MIN_GAS = "100000000000000";
const I64_MAX = 2n ** 63n - 1n;

export const Intent = z.discriminatedUnion("intent", [
  z.strictObject({ intent: z.literal("token_diff"), diff: z.record(z.string(), z.string()) }),
  z.strictObject({
    intent: z.literal("transfer"),
    receiver_id: z.string(),
    tokens: z.record(z.string(), z.string()),
    msg: z.string().exactOptional(),
    min_gas: z.string().exactOptional(),
  }),
]);
export type Intent = z.infer<typeof Intent>;

export const Payload = z.strictObject({
  signer_id: z.string(),
  verifying_contract: z.string(),
  deadline: z.string(),
  nonce: z.base64(),
  intents: z.array(Intent),
});
export type Payload = z.infer<typeof Payload>;

export function amounts(diff: Diff): Record<string, string> {
  return Object.fromEntries(Object.entries(diff).map(([asset, amount]) => [asset, amount.toString()]));
}

export function tokenDiff(diff: Diff): Intent {
  return { intent: "token_diff", diff: amounts(diff) };
}

export function writeOptions(optionsContract: string, collateralAsset: string, collateral: bigint, seriesId: string): Intent {
  if (collateral <= 0n) throw new Error("collateral must be positive");
  return {
    intent: "transfer",
    receiver_id: optionsContract,
    tokens: { [collateralAsset]: collateral.toString() },
    msg: JSON.stringify({ action: "write", series_id: seriesId }),
    min_gas: MIN_GAS,
  };
}

export function relayedTransfer(receiverId: string, relayerId: string, asset: string, amount: bigint, fee: bigint): Intent[] {
  if (amount <= 0n) throw new Error("amount must be positive");
  return [
    { intent: "transfer", receiver_id: receiverId, tokens: amounts({ [asset]: amount }) },
    { intent: "transfer", receiver_id: relayerId, tokens: amounts({ [asset]: fee }) },
  ];
}

export function exerciseOptions(optionsContract: string, tokens: Diff): Intent {
  return closeOptions(optionsContract, "exercise", tokens);
}

export function closeOptions(optionsContract: string, action: "exercise" | "redeem" | "burn_pair", tokens: Diff): Intent {
  const entries = Object.entries(tokens);
  if (entries.length === 0 || entries.length > 10) throw new Error(`${action} takes 1 to 10 tokens`);
  for (const [asset, amount] of entries) {
    if (!asset.startsWith(`nep245:${optionsContract}:`)) throw new Error(`${asset} is not an option token of ${optionsContract}`);
    if (amount <= 0n) throw new Error("amount must be positive");
  }
  return {
    intent: "transfer",
    receiver_id: optionsContract,
    tokens: amounts(tokens),
    msg: JSON.stringify({ action }),
    min_gas: MIN_GAS,
  };
}

export function versionedNonce(salt: Uint8Array, deadlineMs: number, random: Uint8Array): string {
  if (salt.length !== 4) throw new Error("salt must be 4 bytes");
  if (random.length !== 15) throw new Error("random part must be 15 bytes");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || BigInt(deadlineMs) * 1_000_000n > I64_MAX) {
    throw new Error("bad deadline");
  }
  const bytes = new Uint8Array(32);
  bytes.set(NONCE_MAGIC, 0);
  bytes.set(salt, 5);
  new DataView(bytes.buffer).setBigInt64(9, BigInt(deadlineMs) * 1_000_000n, true);
  bytes.set(random, 17);
  return btoa(String.fromCharCode(...bytes));
}

export function isVersionedNonce(nonce: string): boolean {
  const bytes = Uint8Array.from(atob(nonce), (c) => c.charCodeAt(0));
  return bytes.length === 32 && NONCE_MAGIC.every((byte, i) => bytes[i] === byte) && bytes[4] === 0;
}

export function sessionPayload(verifyingContract: string, signerId: string, deadlineMs: number, salt: Uint8Array, random: Uint8Array): Payload {
  return {
    signer_id: signerId,
    verifying_contract: verifyingContract,
    deadline: new Date(deadlineMs).toISOString(),
    nonce: versionedNonce(salt, deadlineMs, random),
    intents: [],
  };
}

export function payload(
  verifyingContract: string,
  signerId: string,
  deadlineMs: number,
  salt: Uint8Array,
  random: Uint8Array,
  intents: Intent[],
): Payload {
  if (intents.length === 0) throw new Error("payload needs at least one intent");
  return { ...sessionPayload(verifyingContract, signerId, deadlineMs, salt, random), intents };
}
