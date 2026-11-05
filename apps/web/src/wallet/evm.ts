import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { erc191Signed } from "./intentSigning.ts";
import type { Wallet } from "./wallet.ts";

export function hasInjectedEvm(): boolean {
  return "ethereum" in window;
}

export async function connectEvm(): Promise<Wallet> {
  const provider = (window as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error("No browser wallet found. Install MetaMask or Rabby.");
  const client = createWalletClient({ transport: custom(provider) });
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("No account shared by the wallet");
  return {
    kind: "evm",
    accountId: address.toLowerCase(),
    standard: "erc191",
    publicKey: undefined,
    async sign(unsigned) {
      if (unsigned.standard !== "erc191") throw new Error("EVM wallets sign erc191 messages");
      return erc191Signed(unsigned, await client.signMessage({ account: address, message: unsigned.payload }));
    },
    call: undefined,
    disconnect: async () => {},
  };
}
