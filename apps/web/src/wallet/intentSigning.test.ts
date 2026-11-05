import { payload, SignedPayload, tokenDiff, toSign, type Unsigned } from "@near-options/sdk";
import { base58, base64 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { erc191Signed, nep413Signed } from "./intentSigning.ts";

const p = payload("intents.near", "alice.near", 1_800_000_000_000, new Uint8Array(4), new Uint8Array(15), [tokenDiff({ "nep141:usdc": -5n, "nep245:opt:X": 1n })]);
const nep413 = toSign("nep413", p) as Extract<Unsigned, { standard: "nep413" }>;
const erc191 = toSign("erc191", p) as Extract<Unsigned, { standard: "erc191" }>;

describe("signed payloads", () => {
  it("converts a base64 nep413 signature to ed25519 base58 and keeps prefixed ones", () => {
    const raw = new Uint8Array(64).fill(7);
    const signed = nep413Signed(nep413, "ed25519:pk", base64.encode(raw));
    expect(SignedPayload.parse(signed).signature).toBe(`ed25519:${base58.encode(raw)}`);
    expect(nep413Signed(nep413, "ed25519:pk", "ed25519:abc").signature).toBe("ed25519:abc");
  });

  it("normalises the erc191 recovery byte to 0/1", () => {
    const signed = SignedPayload.parse(erc191Signed(erc191, `0x${"11".repeat(64)}1c`));
    const bytes = base58.decode(signed.signature.replace("secp256k1:", ""));
    expect(bytes[64]).toBe(1);
    expect(bytes.length).toBe(65);
  });

  it("rejects malformed erc191 signatures", () => {
    expect(() => erc191Signed(erc191, `0x${"11".repeat(64)}`)).toThrow(/length/);
    expect(() => erc191Signed(erc191, `0x${"11".repeat(64)}05`)).toThrow(/recovery/);
  });
});
