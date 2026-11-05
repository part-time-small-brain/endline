import type { Wallet } from "./wallet.ts";

const SIGN_DELAY_MS = 900;

export function demoWallet(): Wallet {
  return {
    kind: "demo",
    accountId: "demo.near",
    standard: "nep413",
    publicKey: "ed25519:demo",
    async sign(unsigned) {
      await new Promise((resolve) => setTimeout(resolve, SIGN_DELAY_MS));
      return { ...unsigned, public_key: "ed25519:demo", signature: "ed25519:demo" };
    },
    call: undefined,
    disconnect: async () => {},
  };
}
