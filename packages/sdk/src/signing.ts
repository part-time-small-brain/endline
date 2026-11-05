import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 as bs58, base64, hex } from "@scure/base";
import { z } from "zod";
import { Payload } from "./intents.ts";

const base58 = (curve: string) => z.string().regex(new RegExp(`^${curve}:[1-9A-HJ-NP-Za-km-z]+$`));

const Nep413 = z.strictObject({
  standard: z.literal("nep413"),
  payload: z.strictObject({ message: z.string(), nonce: z.base64(), recipient: z.string() }),
});
const Erc191 = z.strictObject({ standard: z.literal("erc191"), payload: z.string() });

export const Unsigned = z.discriminatedUnion("standard", [Nep413, Erc191]);
export type Unsigned = z.infer<typeof Unsigned>;
export type Standard = Unsigned["standard"];

export const SignedPayload = z.discriminatedUnion("standard", [
  Nep413.extend({ public_key: base58("ed25519"), signature: base58("ed25519") }),
  Erc191.extend({ signature: base58("secp256k1") }),
]);
export type SignedPayload = z.infer<typeof SignedPayload>;

const Nep413Message = Payload.omit({ verifying_contract: true, nonce: true });

export function toSign(standard: Standard, p: Payload): Unsigned {
  if (standard === "erc191") return { standard, payload: JSON.stringify(p) };
  const message = JSON.stringify({ deadline: p.deadline, intents: p.intents, signer_id: p.signer_id });
  return { standard, payload: { message, nonce: p.nonce, recipient: p.verifying_contract } };
}

const signedText = (u: Unsigned) => (u.standard === "erc191" ? u.payload : u.payload.message);

export function readPayload(signed: Unsigned): Payload {
  const p =
    signed.standard === "erc191"
      ? Payload.parse(JSON.parse(signed.payload))
      : { ...Nep413Message.parse(JSON.parse(signed.payload.message)), verifying_contract: signed.payload.recipient, nonce: signed.payload.nonce };
  if (signedText(toSign(signed.standard, p)) !== signedText(signed) || btoa(atob(p.nonce)) !== p.nonce) throw new Error("payload is not canonically encoded");
  return p;
}

const NEP413_TAG = 2 ** 31 + 413;

function u32(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n, true);
  return bytes;
}

function borshString(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text);
  return Uint8Array.from([...u32(bytes.length), ...bytes]);
}

function nep413Hash({ message, nonce, recipient }: { message: string; nonce: string; recipient: string }): Uint8Array {
  return sha256(Uint8Array.from([...u32(NEP413_TAG), ...borshString(message), ...base64.decode(nonce), ...borshString(recipient), 0]));
}

export function implicitSigner(seed: Uint8Array) {
  if (seed.length !== 32) throw new Error("an ed25519 seed is 32 bytes");
  const key = ed25519.getPublicKey(seed);
  const publicKey = `ed25519:${bs58.encode(key)}`;
  return {
    accountId: hex.encode(key),
    publicKey,
    sign(unsigned: Unsigned): Extract<SignedPayload, { standard: "nep413" }> {
      if (unsigned.standard !== "nep413") throw new Error("an implicit key signs nep413 only");
      return { ...unsigned, public_key: publicKey, signature: `ed25519:${bs58.encode(ed25519.sign(nep413Hash(unsigned.payload), seed))}` };
    },
  };
}
