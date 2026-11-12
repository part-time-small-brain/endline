import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Fill, type Intent, payload, readPayload, type SignedPayload, tokenDiff, writeOptions } from "@endline/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Claims } from "./claims.ts";
import { Collector } from "./collect.ts";
import { Rejected, Unsettled } from "./rpc.ts";
import { fakeChain, httpStatus, INTENTS, MIN_WRITE, nep413, OPTION, OPTIONS, SALT, SERIES, USDC } from "./test-fakes.ts";

const SHORT = `${OPTION}-SHORT`;
const AMOUNT = "1000000";
const FINAL_AT = SERIES.expiry + 3_600;
const transfer = (msg: object, tokens: Record<string, string> = { [OPTION]: AMOUNT }): Intent => ({
  intent: "transfer",
  receiver_id: OPTIONS,
  tokens,
  msg: JSON.stringify(msg),
  min_gas: "100000000000000",
});
const exercise = transfer({ action: "exercise" });

function signed(intents: Intent[], { verifyingContract = INTENTS, deadlineMs = Date.now() + 5 * 60_000, signer = "alice.test" } = {}) {
  return nep413(payload(verifyingContract, signer, deadlineMs, SALT, randomBytes(15), intents));
}
const claimed = (intents: Intent[], options: { signer?: string } = {}) => signed(intents, { deadlineMs: (SERIES.expiry + 7 * 86_400) * 1000, ...options });

const fill = (account_id: string, side: Fill["side"], size: bigint): Fill => ({
  quote_id: "q",
  series_id: SERIES.id,
  side,
  account_id,
  size: size.toString(),
  premium: "1",
  tx_hash: "tx",
  at_ms: 0,
});
const boughtPlenty = { byAccount: (account: string) => Array.from({ length: 20 }, () => fill(account, "buy", 10n ** 17n)) };

function setup(fills = boughtPlenty) {
  const fake = fakeChain();
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const claims = new Claims(dir);
  const collector = new Collector(fake.chain, { intents_id: INTENTS, options_id: OPTIONS }, claims, fills);
  const settle = (price = "120000000000") => fake.settlements.set(`${SERIES.underlying}:${SERIES.expiry}`, { price, final_at: FINAL_AT });
  return { ...fake, dir, claims, collector, settle };
}

describe("gasless collect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime((FINAL_AT + 61) * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("executes an exercise once the price is final, and an early refusal keeps the payload usable", async () => {
    const { collector, executed, settle } = setup();
    const early = signed([exercise]);
    expect(await httpStatus(collector.execute(early))).toBe(409);
    settle();
    vi.setSystemTime((FINAL_AT + 59) * 1000);
    expect(await httpStatus(collector.execute(early))).toBe(409);
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    expect(await collector.execute(early)).toBe("tx1");
    expect(executed).toHaveLength(1);
  });

  it("reads a settlement until it is final, then never again, so forged payloads can't repeat the view", async () => {
    const { chain, collector, settle } = setup();
    const read = vi.spyOn(chain, "settlement");
    settle(SERIES.strike);
    vi.setSystemTime((FINAL_AT + 59) * 1000);
    expect(await httpStatus(collector.execute(signed([exercise])))).toBe(409);
    settle();
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    expect(await collector.execute(signed([exercise]))).toBe("tx1");
    const forged = { ...signed([exercise], { signer: "mallory.test" }), signature: "ed25519:bad" } as SignedPayload;
    for (let i = 0; i < 5; i++) expect(await httpStatus(collector.execute(forged))).toBe(422);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("sends a signed exercise on-chain once, however often and concurrently it is posted", async () => {
    const { collector, executed, settle } = setup();
    settle();
    const once = signed([exercise]);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => collector.execute(once)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(executed).toHaveLength(1);
  });

  it("sends one exercise per signer at a time, and takes deadlines only between 2 and 10 minutes away", async () => {
    const { collector, executed, settle } = setup();
    settle();
    const alice = await Promise.allSettled([signed([exercise]), signed([exercise])].map((s) => collector.execute(s)));
    expect(alice.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    await Promise.all([signed([exercise], { signer: "bob.test" }), signed([exercise], { signer: "carol.test" })].map((s) => collector.execute(s)));
    expect(executed).toHaveLength(3);
    expect(await httpStatus(collector.execute(signed([exercise], { deadlineMs: Date.now() + 10 * 60_000 + 1 })))).toBe(400);
    expect(await httpStatus(collector.execute(signed([exercise], { deadlineMs: Date.now() + 119_999 })))).toBe(400);
    expect(await collector.execute(signed([exercise], { deadlineMs: Date.now() + 10 * 60_000 }))).toBe("tx4");
    expect(await collector.execute(signed([exercise], { deadlineMs: Date.now() + 120_000, signer: "dave.test" }))).toBe("tx5");
  });

  it("measures the 2 minutes left after its own simulation, right before sending", async () => {
    const { chain, collector, executed, settle } = setup();
    settle();
    const now = Date.now();
    const simulate = chain.simulate;
    vi.spyOn(chain, "simulate").mockImplementationOnce(async (batch) => {
      vi.setSystemTime(now + 1);
      return simulate(batch);
    });
    expect(await httpStatus(collector.execute(signed([exercise], { deadlineMs: now + 120_000 })))).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it.each([
    ["whitespace padding", (m: string) => m.replace("{", `{${" ".repeat(60_000)}`)],
    ["a duplicate msg key", (m: string) => m.replace('"msg":', '"msg":"{\\"action\\":\\"burn_pair\\"}","msg":')],
  ])("refuses a message with %s", async (_, edit) => {
    const { collector, executed, settle } = setup();
    settle();
    const s = signed([exercise]);
    const bad = { ...s, payload: { ...s.payload, message: edit(s.payload.message) } };
    expect(bad.payload.message).not.toBe(s.payload.message);
    expect(await httpStatus(collector.execute(bad))).toBe(400);
    expect(await httpStatus(collector.claim(bad))).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it.each([
    ["a token_diff", [tokenDiff({ [USDC]: -1n, [OPTION]: 1n })]],
    ["a write", [writeOptions(OPTIONS, USDC, 5n, SERIES.id)]],
    ["a transfer to another receiver", [{ ...exercise, receiver_id: "evil.test" }]],
    ["a transfer without a notification", [{ ...exercise, msg: "" }]],
    ["an extra field in msg", [transfer({ action: "exercise", series_id: SERIES.id })]],
    ["a different min_gas", [{ ...exercise, min_gas: "300000000000000" }]],
    ["a non-canonical amount", [transfer({ action: "exercise" }, { [OPTION]: `0${AMOUNT}` })]],
    ["a foreign token", [transfer({ action: "exercise" }, { [USDC]: AMOUNT })]],
    ["another contract's option", [transfer({ action: "exercise" }, { [`nep245:evil.test:${SERIES.id}`]: AMOUNT })]],
    ["an unknown series", [transfer({ action: "exercise" }, { [`nep245:${OPTIONS}:BTC-27NOV26-1-C`]: AMOUNT })]],
    ["exercising short tokens", [transfer({ action: "exercise" }, { [SHORT]: AMOUNT })]],
    ["a redeem", [transfer({ action: "redeem" }, { [SHORT]: AMOUNT })]],
    ["a burn_pair", [transfer({ action: "burn_pair" }, { [OPTION]: AMOUNT, [SHORT]: AMOUNT })]],
    ["two intents", [exercise, exercise]],
  ])("refuses %s and pays no gas", async (_, intents) => {
    const { collector, executed, settle } = setup();
    settle();
    expect(await httpStatus(collector.execute(signed(intents as Intent[])))).toBe(400);
    expect(await httpStatus(collector.claim(signed(intents as Intent[])))).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it("refuses options that pay nothing or are below the minimum write size, without sending a transaction", async () => {
    const { collector, executed, settle } = setup();
    settle(SERIES.strike);
    expect(await httpStatus(collector.execute(signed([exercise])))).toBe(400);
    settle();
    expect(await httpStatus(collector.execute(signed([transfer({ action: "exercise" }, { [OPTION]: String(MIN_WRITE - 1n) })])))).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it.each([
    ["it can't read, which would slip past the 10-minute cap", () => '"deadline":"29991231T000000Z"'],
    ["padded with digits it reads past, which would make the relayer pay gas for every byte", (deadline: string) => `"deadline":"${deadline.replace("Z", "0".repeat(60_000))}Z"`],
  ])("refuses a deadline %s", async (_, rewrite: (deadline: string) => string) => {
    const { collector, executed, settle } = setup();
    settle();
    const s = signed([exercise]);
    const bad = { ...s, payload: { ...s.payload, message: s.payload.message.replace(/"deadline":"([^"]+)"/, (_, deadline: string) => rewrite(deadline)) } };
    expect(bad.payload.message).not.toBe(s.payload.message);
    expect(await httpStatus(collector.execute(bad))).toBe(400);
    expect(executed).toHaveLength(0);
  });

  it("pays gas only for a total payout of at least $1", async () => {
    const under = setup();
    under.settle("110099000000");
    expect(await httpStatus(under.collector.execute(signed([exercise])))).toBe(400);
    const { collector, executed, settle } = setup();
    settle("110100000000");
    expect(await collector.execute(signed([exercise]))).toBe("tx1");
    expect(executed).toHaveLength(1);
  });

  it("refuses a payload for another verifier", async () => {
    const { collector, settle } = setup();
    settle();
    expect(await httpStatus(collector.execute(signed([exercise], { verifyingContract: "evil.test" })))).toBe(400);
  });

  it("refuses what the verifier would refuse, without sending a transaction, and takes the payload once it passes", async () => {
    const { chain, collector, executed, settle } = setup();
    settle();
    expect(await httpStatus(collector.execute({ ...signed([exercise]), signature: "ed25519:bad" } as SignedPayload))).toBe(422);
    const later = signed([exercise]);
    const refuse = vi.spyOn(chain, "simulate").mockRejectedValue(new Rejected("balance not deposited yet"));
    expect(await httpStatus(collector.execute(later))).toBe(422);
    refuse.mockRestore();
    expect(await collector.execute(later)).toBe("tx1");
    expect(executed).toHaveLength(1);
  });
});

describe("gasless sends whose execute call errored", () => {
  const NOW = (FINAL_AT + 61) * 1000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it("answers an exercise whose relayer transaction ran as sent, with that transaction, so the user never signs it again", async () => {
    const { chain, collector, executed, settle } = setup();
    settle();
    const execute = chain.execute;
    vi.spyOn(chain, "execute").mockImplementationOnce(async (batch) => {
      throw new Unsettled([await execute(batch)], new Error("Internal server error"));
    });
    expect(await collector.execute(signed([exercise]))).toBe("tx1");
    expect(executed).toHaveLength(1);
  });

  it("fails an exercise whose relayer transaction failed, even though the signer burned the nonce with another payload", async () => {
    const { chain, collector, executed, settle } = setup();
    settle();
    const execute = chain.execute;
    const s = signed([exercise]);
    const burn = nep413({ ...readPayload(s), intents: [] });
    vi.spyOn(chain, "execute").mockImplementationOnce(async (batch) => {
      await execute([burn]);
      return execute(batch);
    });
    await expect(collector.execute(s)).rejects.toThrow("nonce already used");
    expect(executed).toEqual([[burn]]);
  });

  it("fails an exercise of unknown outcome only once a final block is past the deadline with its transaction still unknown, never on a read error, and holds the signer's lock until then", async () => {
    const { chain, collector, executed, settle } = setup();
    settle();
    vi.spyOn(chain, "execute").mockRejectedValueOnce(new Unsettled(["lost"], new Error("Request timeout")));
    const s = signed([exercise]);
    const deadline = Date.parse(readPayload(s).deadline);
    vi.spyOn(chain, "finalTimeMs").mockImplementation(async () => {
      if (Date.now() > deadline + 60_000 && Date.now() < deadline + 67_000) throw new Error("rpc down");
      return Date.now() - 1_000;
    });
    let result: unknown;
    void collector.execute(s).then((tx) => (result = tx), (error: unknown) => (result = error));
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 60_000);
    expect(result).toBeUndefined();
    expect(await httpStatus(collector.execute(signed([exercise])))).toBe(409);
    await vi.advanceTimersByTimeAsync(60_000 + 66_000);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(result).toMatchObject({ message: "Request timeout" });
    expect(await collector.execute(signed([exercise]))).toBe("tx1");
    expect(executed).toHaveLength(1);
  });
});

describe("auto-collect claims", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime((SERIES.expiry - 86_400) * 1000);
  });
  afterEach(() => vi.useRealTimers());

  it("stores an exercise before expiry and submits it only once the price is final", async () => {
    const { collector, claims, executed, settle, dir } = setup();
    await collector.claim(claimed([exercise]));
    await collector.submitClaims();
    vi.setSystemTime((FINAL_AT + 30) * 1000);
    settle();
    await collector.submitClaims();
    expect(executed).toHaveLength(0);

    const reloaded = new Claims(dir);
    await reloaded.load();
    expect(reloaded.all()).toEqual(claims.all());

    vi.setSystemTime((FINAL_AT + 60) * 1000);
    await collector.submitClaims();
    expect(executed).toHaveLength(1);
    expect(claims.all()).toEqual([]);
  });

  it("drops a claim with under 2 minutes left instead of sending one that could expire on-chain", async () => {
    const { collector, claims, executed, settle } = setup();
    await collector.claim(claimed([exercise]));
    vi.setSystemTime((SERIES.expiry + 7 * 86_400) * 1000 - 119_999);
    settle();
    await collector.submitClaims();
    expect(executed).toHaveLength(0);
    expect(claims.all()).toEqual([]);
  });

  it("drops a claim the verifier refuses at submit time, and keeps it through RPC errors", async () => {
    const { chain, collector, claims, executed, settle } = setup();
    const claim = claimed([exercise]);
    await collector.claim(claim);
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    settle();
    const simulate = vi.spyOn(chain, "simulate").mockRejectedValueOnce(new Error("rpc down"));
    await collector.submitClaims();
    expect(claims.all()).toHaveLength(1);

    await chain.execute([claim]);
    simulate.mockRestore();
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    expect(executed).toHaveLength(1);
  });

  it("never queues more claims on a token than the signer holds, also under concurrent posts", async () => {
    const { collector, claims, balances } = setup();
    balances.set(`alice.test:${OPTION}`, 3n * BigInt(AMOUNT));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => collector.claim(claimed([exercise]))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(claims.all()).toHaveLength(3);
    expect(await httpStatus(collector.claim(claimed([exercise])))).toBe(409);
    await expect(collector.claim(claimed([exercise], { signer: "bob.test" }))).resolves.toBeUndefined();
  });

  it("takes claims only on options the signer bought here, net of what they sold", async () => {
    const fills: Fill[] = [];
    const { collector, claims } = setup({ byAccount: (account: string) => fills.filter((f) => f.account_id === account) });
    expect(await httpStatus(collector.claim(claimed([exercise])))).toBe(409);
    fills.push(fill("alice.test", "buy", 2n * BigInt(AMOUNT)), fill("alice.test", "sell", BigInt(AMOUNT)), fill("bob.test", "buy", BigInt(AMOUNT)));
    await collector.claim(claimed([exercise]));
    expect(await httpStatus(collector.claim(claimed([exercise])))).toBe(409);
    expect(claims.all()).toHaveLength(1);
  });

  it("takes one claim per buy, so a single trade can't be split to fill the queue", async () => {
    const { collector, claims } = setup({ byAccount: (account: string) => [fill(account, "buy", 100n * BigInt(AMOUNT))] });
    await collector.claim(signed([exercise]));
    expect(await httpStatus(collector.claim(signed([exercise])))).toBe(409);
    expect(claims.all()).toHaveLength(1);
  });

  it("refuses a claim whose most it could pay is under $1", async () => {
    const { collector, claims } = setup();
    const under = transfer({ action: "exercise" }, { [OPTION]: "49999" });
    expect(await httpStatus(collector.claim(claimed([under])))).toBe(400);
    await collector.claim(claimed([transfer({ action: "exercise" }, { [OPTION]: "50000" })]));
    expect(claims.all()).toHaveLength(1);
  });

  it("drops a dead claim before settlement, so it stops counting against the holder", async () => {
    const { chain, collector, claims, balances } = setup();
    balances.set(`alice.test:${OPTION}`, BigInt(AMOUNT));
    const first = claimed([exercise]);
    await collector.claim(first);
    await expect(collector.claim(first)).resolves.toBeUndefined();
    await chain.execute([first]);
    const second = claimed([exercise]);
    expect(await httpStatus(collector.claim(second))).toBe(409);
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    await expect(collector.claim(second)).resolves.toBeUndefined();
  });

  it("resends a claim only if its failed send never used the nonce", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { chain, collector, claims, executed, settle } = setup();
    await collector.claim(claimed([exercise]));
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    settle();
    const execute = chain.execute;
    const send = vi.spyOn(chain, "execute").mockRejectedValueOnce(new Error("rpc down"));
    await collector.submitClaims();
    expect(claims.all()).toHaveLength(1);
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);

    const landed = claimed([exercise], { signer: "bob.test" });
    await collector.claim(landed);
    send.mockImplementationOnce(async (batch) => {
      await execute(batch);
      throw new Error("timeout after broadcast");
    });
    await collector.submitClaims();
    expect(claims.all()).toEqual([landed]);
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    expect(executed).toHaveLength(2);
  });

  it("keeps a final claim through repeated RPC errors until it is sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { chain, collector, claims, executed, settle } = setup();
    await collector.claim(claimed([exercise]));
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    settle();
    vi.spyOn(chain, "execute").mockRejectedValueOnce(new Error("rpc down"));
    vi.spyOn(chain, "simulate").mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("rpc down"));
    await collector.submitClaims();
    await collector.submitClaims();
    expect(claims.all()).toHaveLength(1);
    expect(executed).toHaveLength(0);
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    expect(executed).toHaveLength(1);
  });

  it("drops a claim that pays nothing at settlement, without sending it", async () => {
    const { collector, claims, executed, settle } = setup();
    await collector.claim(claimed([exercise]));
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    settle(SERIES.strike);
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it("drops a claim that pays under $1 at settlement, without sending it", async () => {
    const { collector, claims, executed, settle } = setup();
    await collector.claim(claimed([exercise]));
    vi.setSystemTime((FINAL_AT + 60) * 1000);
    settle("110050000000");
    await collector.submitClaims();
    expect(claims.all()).toEqual([]);
    expect(executed).toHaveLength(0);
  });

  it("keeps taking claims when a stored one no longer parses", async () => {
    const { collector, claims, dir } = setup();
    const good = claimed([exercise]);
    const padded = { ...good, payload: { ...good.payload, message: ` ${good.payload.message}` } };
    writeFileSync(join(dir, "claims.json"), JSON.stringify([padded]));
    await claims.load();
    await expect(collector.claim(claimed([exercise], { signer: "bob.test" }))).resolves.toBeUndefined();
  });

  it("caps open claims per signer, so one account can't fill the queue, also under concurrent posts", async () => {
    const { collector, claims } = setup({ byAccount: (account: string) => Array.from({ length: 150 }, () => fill(account, "buy", 10n ** 17n)) });
    const results = await Promise.allSettled(Array.from({ length: 110 }, () => collector.claim(claimed([exercise]))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(100);
    expect(claims.all()).toHaveLength(100);
    expect(await httpStatus(collector.claim(claimed([exercise])))).toBe(409);
    await expect(collector.claim(claimed([exercise], { signer: "bob.test" }))).resolves.toBeUndefined();
  });

  it("caps open claims across all signers", async () => {
    const { collector, claims, dir } = setup();
    const full = Array.from({ length: 1_000 }, (_, i) => claimed([exercise], { signer: `user${i}.test` }));
    writeFileSync(join(dir, "claims.json"), JSON.stringify(full));
    await claims.load();
    expect(await httpStatus(collector.claim(claimed([exercise], { signer: "new.test" })))).toBe(503);
  });
});
