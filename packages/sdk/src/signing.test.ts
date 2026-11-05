import { createIntentSignerNEP413, createIntentSignerViem } from "@defuse-protocol/intents-sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { payload, sessionPayload, tokenDiff } from "./intents.ts";
import { implicitSigner, readPayload, SignedPayload, toSign, type Unsigned } from "./signing.ts";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const salt = Uint8Array.from([1, 2, 3, 4]);
const random = Uint8Array.from({ length: 15 }, (_, i) => i);
const intent = (signerId: string) =>
  payload("intents.test", signerId, 1_792_742_400_123, salt, random, [tokenDiff({ "nep141:usdc.test": -35_000_000n, "nep245:opt.test:X": 1_000_000n })]);

describe("what the wallet signs", () => {
  it("matches the intents-sdk NEP-413 signer byte for byte", async () => {
    const p = intent("alice.near");
    const signer = createIntentSignerNEP413({ accountId: "alice.near", signMessage: () => ({ publicKey: "ed25519:pk", signature: "ed25519:sig" }) });
    const signed = SignedPayload.parse(await signer.signIntent(p));
    expect({ standard: signed.standard, payload: signed.payload }).toEqual(toSign("nep413", p));
  });

  it("matches the intents-sdk ERC-191 signer byte for byte", async () => {
    const address = "0x00000000000000000000000000000000000000aa";
    const p = intent(address);
    const signer = createIntentSignerViem({ signer: { address, signMessage: async () => `0x${"11".repeat(64)}1b` } as never });
    const signed = SignedPayload.parse(await signer.signIntent(p));
    expect({ standard: signed.standard, payload: signed.payload }).toEqual(toSign("erc191", p));
  });

  it("signs a session as an empty intents list, read back unchanged", async () => {
    const p = sessionPayload("intents.test", "alice.near", 1_792_742_400_123, salt, random);
    const signer = createIntentSignerNEP413({ accountId: "alice.near", signMessage: () => ({ publicKey: "ed25519:pk", signature: "ed25519:sig" }) });
    const signed = SignedPayload.parse(await signer.signIntent(p));
    expect(readPayload(signed)).toEqual({ ...intent("alice.near"), intents: [] });
    expect(readPayload(toSign("erc191", p))).toEqual(p);
  });

  it("reads back the exact payload from both formats", () => {
    const p = intent("alice.near");
    expect(readPayload(toSign("nep413", p))).toEqual(p);
    expect(readPayload(toSign("erc191", p))).toEqual(p);
  });

  it("refuses every encoding but the one toSign produces", () => {
    const p = intent("alice.near");
    const nep = toSign("nep413", p) as Extract<Unsigned, { standard: "nep413" }>;
    const { signer_id, ...rest } = p;
    const { nonce } = nep.payload;
    const sameBytesNonce = `${nonce.slice(0, -2)}${B64[B64.indexOf(nonce.at(-2)!) ^ 1]}=`;
    expect(Buffer.from(sameBytesNonce, "base64")).toEqual(Buffer.from(nonce, "base64"));
    const variants: Unsigned[] = [
      { standard: "erc191", payload: JSON.stringify({ ...rest, signer_id }) },
      { standard: "erc191", payload: ` ${JSON.stringify(p)}` },
      { standard: "erc191", payload: JSON.stringify({ ...p, nonce: sameBytesNonce }) },
      { ...nep, payload: { ...nep.payload, message: nep.payload.message.replace('"intents":', '"intents":[],"intents":') } },
      { ...nep, payload: { ...nep.payload, nonce: sameBytesNonce } },
    ];
    for (const variant of variants) expect(() => readPayload(variant)).toThrow();
  });

  it("refuses intents the verifier would run but we never build", () => {
    const p = { ...intent("alice.near"), intents: [{ intent: "add_public_key", public_key: "ed25519:x" }] };
    expect(() => readPayload({ standard: "erc191", payload: JSON.stringify(p) })).toThrow();
  });
});

describe("implicit signer", () => {
  const seed = hex.decode("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");

  it("derives the RFC 8032 test 1 key and its hex implicit account", () => {
    expect(implicitSigner(seed).accountId).toBe("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  });

  it("signs exactly the hash intents-sdk hands a NEP-413 wallet, over the payload toSign builds", async () => {
    const signer = implicitSigner(seed);
    const p = intent(signer.accountId);
    let hash: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const sdk = createIntentSignerNEP413({ accountId: signer.accountId, signMessage: (_, h) => ((hash = h), { publicKey: "ed25519:pk", signature: "ed25519:sig" }) });
    await sdk.signIntent(p);
    const signed = signer.sign(toSign("nep413", p));
    expect(SignedPayload.parse(signed).payload).toEqual(toSign("nep413", p).payload);
    const decode = (text: string) => base58.decode(text.slice("ed25519:".length));
    expect(ed25519.verify(decode(signed.signature), hash, decode(signed.public_key))).toBe(true);
    expect(ed25519.verify(decode(signed.signature), hash.map((b, i) => (i === 0 ? b ^ 1 : b)), decode(signed.public_key))).toBe(false);
  });

  it("refuses erc191 payloads and seeds that aren't 32 bytes", () => {
    expect(() => implicitSigner(seed).sign(toSign("erc191", intent("x")))).toThrow();
    expect(() => implicitSigner(seed.slice(1))).toThrow();
  });
});
