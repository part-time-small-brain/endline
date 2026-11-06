import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.ts";
import { Faucet } from "./faucet.ts";
import { Refunded } from "./rpc.ts";
import { httpStatus } from "./test-fakes.ts";

const EVM = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
const dir = () => mkdtempSync(join(tmpdir(), "faucet-"));

function faucet(send = vi.fn(async (accountId: string) => `tx-${accountId}`), at = dir(), cap?: number) {
  return { faucet: new Faucet(send, at, cap), send, at };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("faucet", () => {
  it("refuses to start on mainnet", () => {
    const env = {
      RELAYER_ACCOUNT_ID: "relayer.test",
      RELAYER_PRIVATE_KEY: "ed25519:abc",
      MM_API_KEYS: "0123456789abcdef",
      DATA_DIR: "data",
    };
    expect(() => loadConfig({ ...env, NETWORK_ID: "mainnet", FAUCET: "true" })).toThrow("the faucet runs only on testnet");
    expect(() => loadConfig({ ...env, NETWORK_ID: "mainnet", FAUCET: "false" })).toThrow("no deploy/mainnet.json");
    expect(loadConfig({ ...env, NETWORK_ID: "testnet", FAUCET: "true" }).FAUCET).toBe(true);
    expect(loadConfig({ ...env, NETWORK_ID: "testnet" }).FAUCET).toBe(false);
  });

  it("sends to an EVM account", async () => {
    const { faucet: f, send } = faucet();
    expect(await f.drip(EVM, "1.2.3.4")).toBe(`tx-${EVM}`);
    expect(send).toHaveBeenCalledWith(EVM);
  });

  it("gives an account one drip a day, whatever IP asks", async () => {
    const { faucet: f, send } = faucet();
    await f.drip("alice.testnet", "1.1.1.1");
    expect(await httpStatus(f.drip("alice.testnet", "2.2.2.2"))).toBe(429);
    vi.setSystemTime(Date.now() + 86_400_000);
    await f.drip("alice.testnet", "2.2.2.2");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives an IP one drip a day, whatever account it names", async () => {
    const { faucet: f, send } = faucet();
    await f.drip("alice.testnet", "1.1.1.1");
    expect(await httpStatus(f.drip("bob.testnet", "1.1.1.1"))).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends once when the same account or IP asks twice at the same moment", async () => {
    let finish = () => {};
    const send = vi.fn(() => new Promise<string>((resolve) => (finish = () => resolve("tx"))));
    const { faucet: f } = faucet(send);
    const first = f.drip("alice.testnet", "1.1.1.1");
    const sameAccount = httpStatus(f.drip("alice.testnet", "2.2.2.2"));
    const sameIp = httpStatus(f.drip("bob.testnet", "1.1.1.1"));
    expect([await sameAccount, await sameIp]).toEqual([429, 429]);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    finish();
    expect(await first).toBe("tx");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("remembers drips across a restart, and forgets them after a day", async () => {
    const { faucet: f, at } = faucet();
    await f.drip("alice.testnet", "1.1.1.1");
    const restarted = faucet(undefined, at).faucet;
    await restarted.load();
    expect(await httpStatus(restarted.drip("alice.testnet", "2.2.2.2"))).toBe(429);
    expect(await httpStatus(restarted.drip("bob.testnet", "1.1.1.1"))).toBe(429);
    vi.setSystemTime(Date.now() + 86_400_001);
    await restarted.drip("alice.testnet", "1.1.1.1");
  });

  it("stops at the daily cap, counting drips still in flight", async () => {
    const send = vi.fn(() => new Promise<string>(() => {}));
    const { faucet: f } = faucet(send, dir(), 2);
    void f.drip("a.testnet", "1.1.1.1");
    void f.drip("b.testnet", "2.2.2.2");
    expect(await httpStatus(f.drip("c.testnet", "3.3.3.3"))).toBe(429);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("frees the account and IP only when the token refunded the transfer", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Refunded("not credited")).mockResolvedValueOnce("tx");
    const { faucet: f } = faucet(send);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await httpStatus(f.drip("alice.testnet", "1.1.1.1"))).toBe(502);
    expect(await f.drip("alice.testnet", "1.1.1.1")).toBe("tx");
  });

  it("treats any other failure as possibly sent, even after a restart", async () => {
    const send = vi.fn().mockRejectedValue(new Error("timeout"));
    const { faucet: f, at } = faucet(send);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await httpStatus(f.drip("alice.testnet", "1.1.1.1"))).toBe(502);
    expect(await httpStatus(f.drip("alice.testnet", "2.2.2.2"))).toBe(429);
    expect(await httpStatus(f.drip("bob.testnet", "1.1.1.1"))).toBe(429);
    const restarted = faucet(undefined, at).faucet;
    await restarted.load();
    expect(await httpStatus(restarted.drip("alice.testnet", "2.2.2.2"))).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("remembers a drip in flight across a crash", async () => {
    let sending = () => {};
    const sent = new Promise<void>((resolve) => (sending = resolve));
    const { faucet: f, at } = faucet(
      vi.fn(() => {
        sending();
        return new Promise<string>(() => {});
      }),
    );
    void f.drip("alice.testnet", "1.1.1.1");
    await sent;
    const restarted = faucet(undefined, at).faucet;
    await restarted.load();
    expect(await httpStatus(restarted.drip("alice.testnet", "2.2.2.2"))).toBe(429);
  });

  it("counts refunded attempts toward the daily cap, so a broken faucet stops spending gas", async () => {
    const send = vi.fn().mockRejectedValue(new Refunded("not credited"));
    const { faucet: f } = faucet(send, dir(), 2);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await httpStatus(f.drip("a.testnet", "1.1.1.1"))).toBe(502);
    expect(await httpStatus(f.drip("a.testnet", "1.1.1.1"))).toBe(502);
    expect(await httpStatus(f.drip("b.testnet", "2.2.2.2"))).toBe(429);
    expect(send).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 86_400_001);
    expect(await httpStatus(f.drip("b.testnet", "2.2.2.2"))).toBe(502);
  });
});
