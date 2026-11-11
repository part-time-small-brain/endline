import { createIntentSignerNEP413, createIntentSignerViem } from "@defuse-protocol/intents-sdk";
import { describe, expect, it } from "vitest";
import { payload, sessionPayload, tokenDiff } from "./intents.ts";
import { readPayload, SignedPayload, toSign, type Unsigned } from "./signing.ts";

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

  it("refuses a nonce that isn't 32 bytes, which would shift the NEP-413 fields after it", () => {
    const p = intent("alice.near");
    for (const nonce of [Buffer.alloc(28, 7).toString("base64"), Buffer.alloc(33, 7).toString("base64")]) {
      expect(() => readPayload({ standard: "erc191", payload: JSON.stringify({ ...p, nonce }) }), nonce).toThrow();
    }
  });

  it("refuses intents the verifier would run but we never build", () => {
    const p = { ...intent("alice.near"), intents: [{ intent: "add_public_key", public_key: "ed25519:x" }] };
    expect(() => readPayload({ standard: "erc191", payload: JSON.stringify(p) })).toThrow();
    const bare = { ...intent("alice.near"), intents: [{ intent: "transfer", receiver_id: "bob.near", tokens: { "nep141:usdc.near": "1" } }] };
    expect(() => readPayload({ standard: "erc191", payload: JSON.stringify(bare) })).toThrow();
  });
});
