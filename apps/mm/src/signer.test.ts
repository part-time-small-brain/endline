import { payload, sessionPayload, tokenDiff } from "@endline/sdk";
import { describe, expect, it } from "vitest";
import { nep413Signer } from "./signer.ts";

const KEY = "ed25519:49W385L4rePHy6PAaQUovbD2aacgN4HsKXSMeUzRg4fmwXszN91JuMFrQRj3vMDpZuRF3ZknQBuRBoWQJEfXstMw";
const salt = Uint8Array.from([1, 2, 3, 4]);
const random = Uint8Array.from({ length: 15 }, (_, i) => i);

describe("nep413Signer", () => {
  it("signs exactly what the intents-sdk NEP-413 signer signed", async () => {
    const sign = nep413Signer(KEY);
    const trade = await sign(payload("intents.test.near", "mm.test.near", 1_792_742_400_123, salt, random, [tokenDiff({ "nep141:usdc.test": -35_000_000n, "nep245:opt.test:BTC-27NOV26-110000_112000-C": 1_000_000n })]));
    const session = await sign(sessionPayload("intents.test.near", "mm.test.near", 1_792_742_400_123, salt, random));
    expect(trade).toMatchObject({
      public_key: "ed25519:FVen3X669xLzsi6N2V91DoiyzHzg1uAgqiT8jZ9nS96Z",
      signature: "ed25519:4AL5K3mazrQJkymeEvakyMXApkhgqsZCJAFPh4TAASjPMxRNZfZeQHG8rBNGVpEMV2jEBQKUMLh4dS2GBWcgbcFA",
    });
    expect(session.signature).toBe("ed25519:mNDbveHyPFfaSuCf4XjRs8VcHn2CxTjyHHeRYsStSg6sV9mKLzhL9LSPpD2hZk7W3tPDaN9161y1eRdoZ2ym9JH");
  });
});
