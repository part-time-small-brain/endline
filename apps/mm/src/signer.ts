import { createIntentSignerNEP413 } from "@defuse-protocol/intents-sdk";
import { type Payload, SignedPayload } from "@near-options/sdk";
import { baseEncode, KeyPair, type KeyPairString } from "near-api-js";

export type SignPayload = (payload: Payload) => Promise<SignedPayload>;

export function nep413Signer(accountId: string, privateKey: KeyPairString): SignPayload {
  const key = KeyPair.fromString(privateKey);
  const signer = createIntentSignerNEP413({
    accountId,
    signMessage: (_payload, hash) => {
      const { signature, publicKey } = key.sign(hash);
      return { publicKey: publicKey.toString(), signature: `ed25519:${baseEncode(signature)}` };
    },
  });
  return async (payload) => SignedPayload.parse(await signer.signIntent(payload));
}
