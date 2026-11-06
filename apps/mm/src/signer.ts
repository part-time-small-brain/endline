import { nep413Hash, type Payload, SignedPayload, toSign, type Unsigned } from "@endline/sdk";
import { baseEncode, KeyPair, type KeyPairString } from "near-api-js";

export type SignPayload = (payload: Payload) => Promise<SignedPayload>;

export function nep413Signer(privateKey: KeyPairString): SignPayload {
  const key = KeyPair.fromString(privateKey);
  return async (payload) => {
    const unsigned = toSign("nep413", payload) as Extract<Unsigned, { standard: "nep413" }>;
    const { signature, publicKey } = key.sign(nep413Hash(unsigned.payload));
    return SignedPayload.parse({ ...unsigned, public_key: publicKey.toString(), signature: `ed25519:${baseEncode(signature)}` });
  };
}
