import { describe, expect, it } from "vitest";
import { txUrl } from "./TxLink.tsx";

describe("txUrl", () => {
  it("links only a base58 transaction hash, so the relay can't point it at another page", () => {
    const hash = "6zgh2u9DqHHiXzdy9ouTP7oGky2T4nugqzqt9wJZwNFm";
    expect(txUrl("mainnet", hash)).toBe(`https://nearblocks.io/txns/${hash}`);
    expect(txUrl("testnet", hash)).toBe(`https://testnet.nearblocks.io/txns/${hash}`);
    expect(txUrl("mainnet", `11${hash.slice(4)}`)).toBe(`https://nearblocks.io/txns/11${hash.slice(4)}`);
    for (const bad of ["", "../address/attacker.near", `${hash}?x`, `${hash}0`, "6zgh2u9DqHHiXzdy9ouTP7oGky2T4nugqzqt9wJZwNF/"]) expect(txUrl("mainnet", bad), bad).toBeUndefined();
  });
});
