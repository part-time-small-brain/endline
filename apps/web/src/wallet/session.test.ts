import { readPayload } from "@endline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWallet } from "./demo.ts";
import { cachedSession, forgetSession, signSession } from "./session.ts";

const salt = async () => new Uint8Array(4);

describe("quote session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("signs once per wallet, again after a cancelled prompt, and never prompts just to check the cache", async () => {
    const wallet = demoWallet();
    const sign = vi.spyOn(wallet, "sign").mockRejectedValueOnce(new Error("cancelled"));
    expect(cachedSession(wallet)).toBeUndefined();
    await expect(signSession(wallet, "intents.near", salt)).rejects.toThrow("cancelled");
    expect(cachedSession(wallet)).toBeUndefined();
    const first = signSession(wallet, "intents.near", salt);
    await vi.runAllTimersAsync();
    const signed = await first;
    expect(readPayload(signed)).toMatchObject({ signer_id: "demo.near", verifying_contract: "intents.near", intents: [] });
    expect(await cachedSession(wallet)).toBe(signed);

    vi.setSystemTime(Date.parse(readPayload(signed).deadline) - 60_001);
    expect(cachedSession(wallet)).toBeDefined();
    vi.setSystemTime(Date.parse(readPayload(signed).deadline) - 60_000);
    expect(cachedSession(wallet)).toBeUndefined();
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it("forgets a session the relay refused", async () => {
    const wallet = demoWallet();
    const sign = vi.spyOn(wallet, "sign");
    const first = signSession(wallet, "intents.near", salt);
    await vi.runAllTimersAsync();
    await first;
    forgetSession(wallet);
    expect(cachedSession(wallet)).toBeUndefined();
    expect(sign).toHaveBeenCalledOnce();
  });
});
