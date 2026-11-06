import { type NearWalletBase, NearConnector, type WalletManifest } from "@hot-labs/near-connect";
import { base64 } from "@scure/base";
import { nep413Signed } from "./intentSigning.ts";
import manifest from "./manifest.json" with { type: "json" };
import type { Wallet } from "./wallet.ts";

let connector: NearConnector | undefined;

// script-src in public/_headers allows this nonce: near-connect's wallet iframes inherit the page's CSP
const WALLET_SCRIPT_NONCE = "C3e81UrLlcvSI878Vp11WNpx";

// upstream's JSON has drifted from the package's WalletManifest type
const pinned = manifest as unknown as { wallets: WalletManifest[]; version: string };

function getConnector(network: "mainnet" | "testnet"): NearConnector {
  connector ??= new NearConnector({ network, features: { signMessage: true }, manifest: pinned, cspNonce: WALLET_SCRIPT_NONCE });
  return connector;
}

async function toWallet(near: NearWalletBase, network: "mainnet" | "testnet"): Promise<Wallet> {
  const [account] = await near.getAccounts({ network });
  if (!account) throw new Error("No NEAR account connected");
  return {
    kind: "near",
    accountId: account.accountId,
    standard: "nep413",
    publicKey: account.publicKey,
    async sign(unsigned) {
      if (unsigned.standard !== "nep413") throw new Error("NEAR wallets sign nep413 messages");
      const { message, nonce, recipient } = unsigned.payload;
      const signed = await near.signMessage({ message, recipient, nonce: base64.decode(nonce), network, signerId: account.accountId });
      return nep413Signed(unsigned, signed.publicKey, signed.signature);
    },
    async call({ receiverId, methodName, args, gas, deposit }) {
      await near.signAndSendTransaction({
        network,
        signerId: account.accountId,
        receiverId,
        actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit } }],
      });
    },
    disconnect: () => getConnector(network).disconnect(near),
  };
}

export async function connectNear(network: "mainnet" | "testnet"): Promise<Wallet> {
  return toWallet(await getConnector(network).connect(), network);
}

export async function restoreNear(network: "mainnet" | "testnet"): Promise<Wallet | null> {
  try {
    const { wallet } = await getConnector(network).getConnectedWallet();
    return await toWallet(wallet, network);
  } catch {
    return null;
  }
}
