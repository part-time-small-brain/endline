import { payload, readPayload, type SignedPayload, tokenDiff, toSign, type Unsigned } from "@endline/sdk";
import { base58, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { erc191Signed, nep413Signed } from "./intentSigning.ts";
import { signSeed, tapWallet } from "./tap.ts";
import type { Wallet } from "./wallet.ts";

const text = (u: Unsigned) => (u.standard === "erc191" ? u.payload : u.payload.message);
const echo = (u: Unsigned) => base58.encode(new TextEncoder().encode(JSON.stringify(u.payload)));
const APP = { network: "mainnet", intentsId: "intents.near", host: "app.endline.trade" };

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
  it("is a different key for another account, network, intents contract or site, and the same each time the wallet signs", async () => {
    const seeds = await Promise.all([
      signSeed(near("alice.near"), APP),
      signSeed(near("alice.near"), APP),
      signSeed(near("bob.near"), APP),
      signSeed(near("alice.near"), { ...APP, network: "testnet" }),
      signSeed(near("alice.near"), { ...APP, intentsId: "intents.evil.near" }),
      signSeed(near("alice.near"), { ...APP, host: "app.endline.trade.evil.com" }),
    ]);
    const [first, again, ...others] = seeds.map((seed) => hex.encode(seed));
    expect(again).toBe(first);
    expect(new Set([first, ...others]).size).toBe(5);
  });

  it("asks the wallet to sign for this site and intents contract only, under the Endline name", async () => {
    const wallet = near("alice.near");
    await signSeed(wallet, APP);
    await signSeed(wallet, { ...APP, host: "endline.trade" });
    const [request, elsewhere] = wallet.seen.map((u) => (u as Extract<Unsigned, { standard: "nep413" }>).payload);
    expect(request).toMatchObject({ recipient: "app.endline.trade", message: expect.stringMatching(/^Endline Tap balance\n\nSign this only on app\.endline\.trade\. .*alice\.near on mainnet for the intents contract intents\.near:/) });
    expect(elsewhere!.recipient).toBe("endline.trade");
    expect(elsewhere!.nonce).not.toBe(request!.nonce);
    const eth = evm(27);
    await signSeed(eth, APP);
    expect(text(eth.seen[0]!)).toBe(request!.message.replace("alice.near", "0xabc"));
  });

  it("gives the same key whichever recovery byte an EVM wallet returns", async () => {
    expect(hex.encode(await signSeed(evm(27), APP))).toBe(hex.encode(await signSeed(evm(0), APP)));
  });

  it("signs a request that can never run as an intent", async () => {
    for (const wallet of [near("alice.near"), evm(27)]) {
      await signSeed(wallet, APP);
      expect(() => readPayload(wallet.seen[0]!)).toThrow();
    }
  });

  it("signs only its own intents for our verifier, and collects through the main wallet's transactions", async () => {
    const call = async () => {};
    const main = { ...near("alice.near"), call };
    const tap = tapWallet(await signSeed(main, APP), main, "intents.near");
    const own = (signer: string, verifier = "intents.near") => toSign("nep413", payload(verifier, signer, Date.now() + 60_000, new Uint8Array(4), new Uint8Array(15), [tokenDiff({ "nep141:usdc.near": -1n })]));
    await expect(tap.sign(own(tap.accountId))).resolves.toMatchObject({ public_key: tap.publicKey });
    await expect(tap.sign(own("alice.near"))).rejects.toThrow();
    await expect(tap.sign(own(tap.accountId, "evil.near"))).rejects.toThrow();
    expect(tap.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(tap.call).toBe(call);
  });
});
