import { readPayload } from "@endline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWallet } from "./demo.ts";
import { cachedSession, forgetSession, signSession } from "./session.ts";

const salt = async () => new Uint8Array(4);

describe("quote session", () => {
  let tab: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    tab = new Map();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => void tab.set(k, v), removeItem: (k: string) => void tab.delete(k) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("keeps a signed session for the tab, so the next page load reuses it without a prompt, but never for another account", async () => {
    const first = signSession(demoWallet(), "intents.near", salt);
    await vi.runAllTimersAsync();
    const signed = await first;
    const reloaded = demoWallet();
    const sign = vi.spyOn(reloaded, "sign");
    expect(await cachedSession(reloaded)).toEqual(signed);
    expect(sign).not.toHaveBeenCalled();
    expect(cachedSession({ ...reloaded, accountId: "other.near" })).toBeUndefined();
    tab.set("session:nep413:other.near", tab.get("session:nep413:demo.near")!);
    expect(cachedSession({ ...reloaded, accountId: "other.near" })).toBeUndefined();
    tab.set("session:nep413:demo.near", "{not json");
    expect(cachedSession(demoWallet())).toBeUndefined();
  });

  it("forgets a session the relay refused", async () => {
    const wallet = demoWallet();
    const sign = vi.spyOn(wallet, "sign");
    const first = signSession(wallet, "intents.near", salt);
    await vi.runAllTimersAsync();
    await first;
    forgetSession(wallet);
    expect(cachedSession(wallet)).toBeUndefined();
    expect(cachedSession(demoWallet())).toBeUndefined();
    expect(sign).toHaveBeenCalledOnce();
  });
});
