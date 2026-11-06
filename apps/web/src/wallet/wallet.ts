import type { SignedPayload, Standard, Unsigned } from "@endline/sdk";

export interface NearCall {
  receiverId: string;
  methodName: string;
  args: object;
  gas: string;
  deposit: string;
}

export interface Wallet {
  kind: "near" | "evm" | "demo";
  accountId: string;
  standard: Standard;
  publicKey: string | undefined;
  sign(unsigned: Unsigned): Promise<SignedPayload>;
  call: ((call: NearCall) => Promise<void>) | undefined;
  disconnect(): Promise<void>;
}
