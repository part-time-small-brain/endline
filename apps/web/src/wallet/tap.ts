import { implicitSigner, readPayload, type SignedPayload, type Unsigned } from "@endline/sdk";
import { base58, base64 } from "@scure/base";
import type { Wallet } from "./wallet.ts";

const RECIPIENT = "near-options";

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
}

function tapMessage(network: string, accountId: string): string {
  return `near·options Tap balance\n\nSign this only on near·options. It unlocks the Tap balance of ${accountId} on ${network}: a separate account that can spend only what you move into it, never your main balance.`;
}

async function tapRequest(main: Wallet, network: string): Promise<Unsigned> {
  const message = tapMessage(network, main.accountId);
  if (main.standard === "erc191") return { standard: "erc191", payload: message };
  const nonce = base64.encode(await sha256(new TextEncoder().encode(`${RECIPIENT} tap balance`)));
  return { standard: "nep413", payload: { message, nonce, recipient: RECIPIENT } };
}

const signatureBytes = (signed: SignedPayload) => base58.decode(signed.signature.slice(signed.signature.indexOf(":") + 1));

export async function signSeed(main: Wallet, network: string): Promise<Uint8Array> {
  return sha256(signatureBytes(await main.sign(await tapRequest(main, network))));
}

export function tapWallet(seed: Uint8Array, main: Wallet, intentsId: string): Wallet {
  const signer = implicitSigner(seed);
  return {
    kind: "tap",
    accountId: signer.accountId,
    standard: "nep413",
    publicKey: signer.publicKey,
    async sign(unsigned) {
      const { signer_id, verifying_contract } = readPayload(unsigned);
      if (signer_id !== signer.accountId || verifying_contract !== intentsId) throw new Error("The Tap key signs only its own intents");
      return signer.sign(unsigned);
    },
    call: main.call,
    disconnect: async () => {},
  };
}
