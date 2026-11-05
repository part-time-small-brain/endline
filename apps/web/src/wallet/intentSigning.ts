import type { SignedPayload, Unsigned } from "@endline/sdk";
import { base58, base64, hex } from "@scure/base";

type Nep413 = Extract<Unsigned, { standard: "nep413" }>;
type Erc191 = Extract<Unsigned, { standard: "erc191" }>;

export function nep413Signed(unsigned: Nep413, publicKey: string, signature: string): SignedPayload {
  const formatted = signature.startsWith("ed25519:") ? signature : `ed25519:${base58.encode(base64.decode(signature))}`;
  return { standard: "nep413", payload: unsigned.payload, public_key: publicKey, signature: formatted };
}

export function erc191Signed(unsigned: Erc191, signature: string): SignedPayload {
  const bytes = hex.decode(signature.replace(/^0x/, ""));
  if (bytes.length !== 65) throw new Error("unexpected signature length");
  const v = bytes[64] ?? 0;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery > 1) throw new Error("unexpected recovery id");
  bytes[64] = recovery;
  return { standard: "erc191", payload: unsigned.payload, signature: `secp256k1:${base58.encode(bytes)}` };
}
