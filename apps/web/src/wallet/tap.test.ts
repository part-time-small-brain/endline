import { payload, readPayload, type SignedPayload, tokenDiff, toSign, type Unsigned } from "@endline/sdk";
import { base58, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { erc191Signed, nep413Signed } from "./intentSigning.ts";
import { signSeed, tapWallet } from "./tap.ts";
import type { Wallet } from "./wallet.ts";

const text = (u: Unsigned) => (u.standard === "erc191" ? u.payload : u.payload.message);
const echo = (u: Unsigned) => base58.encode(new TextEncoder().encode(text(u)));

function fake(accountId: string, standard: Wallet["standard"], sign: (u: Unsigned) => SignedPayload): Wallet & { seen: Unsigned[] } {
  const seen: Unsigned[] = [];
  return {
    kind: standard === "erc191" ? "evm" : "near",
    accountId,
    standard,
    publicKey: undefined,
    seen,
    sign: async (u) => (seen.push(u), sign(u)),
    call: undefined,
    disconnect: async () => {},
  };
}
const near = (accountId: string) => fake(accountId, "nep413", (u) => nep413Signed(u as Extract<Unsigned, { standard: "nep413" }>, "ed25519:pk", `ed25519:${echo(u)}`));
const evm = (v: number) => fake("0xabc", "erc191", (u) => erc191Signed(u as Extract<Unsigned, { standard: "erc191" }>, `0x${"11".repeat(64)}${v.toString(16).padStart(2, "0")}`));

describe("tap key", () => {
  it("is a different key for another account or network, and the same each time the wallet signs", async () => {
    const seeds = await Promise.all([signSeed(near("alice.near"), "mainnet"), signSeed(near("alice.near"), "mainnet"), signSeed(near("bob.near"), "mainnet"), signSeed(near("alice.near"), "testnet")]);
    const [first, again, bob, testnet] = seeds.map((seed) => hex.encode(seed));
    expect(again).toBe(first);
    expect(new Set([first, bob, testnet]).size).toBe(3);
  });

  it("gives the same key whichever recovery byte an EVM wallet returns", async () => {
    expect(hex.encode(await signSeed(evm(27), "mainnet"))).toBe(hex.encode(await signSeed(evm(0), "mainnet")));
  });

  it("signs a request that can never run as an intent", async () => {
    for (const wallet of [near("alice.near"), evm(27)]) {
      await signSeed(wallet, "mainnet");
      expect(() => readPayload(wallet.seen[0]!)).toThrow();
    }
  });

  it("signs only its own intents for our verifier, and collects through the main wallet's transactions", async () => {
    const call = async () => {};
    const main = { ...near("alice.near"), call };
    const tap = tapWallet(await signSeed(main, "mainnet"), main, "intents.near");
    const own = (signer: string, verifier = "intents.near") => toSign("nep413", payload(verifier, signer, Date.now() + 60_000, new Uint8Array(4), new Uint8Array(15), [tokenDiff({ "nep141:usdc.near": -1n })]));
    await expect(tap.sign(own(tap.accountId))).resolves.toMatchObject({ public_key: tap.publicKey });
    await expect(tap.sign(own("alice.near"))).rejects.toThrow();
    await expect(tap.sign(own(tap.accountId, "evil.near"))).rejects.toThrow();
    expect(tap.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(tap.call).toBe(call);
  });
});
