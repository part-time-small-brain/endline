import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { payload, type Quote, type QuoteEvent, type QuoteRequest, readPayload, type SignedPayload, tokenDiff, type Unsigned } from "@near-options/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Auctions, MAX_WAIT_MS } from "./auction.ts";
import { checkBid } from "./bid.ts";
import { Fills } from "./fills.ts";
import { HttpError, type MarketMakers, Relay, SIGN_MARGIN_MS } from "./relay.ts";
import { fakeChain, httpStatus, INTENTS, MIN_WRITE, mmSigned, nep413, OPTION, OPTIONS, SALT, SERIES, session, USDC, WRITE_CUTOFF_SEC } from "./test-fakes.ts";

const PREMIUM = 15_000_000n;
const USER = "alice.test";
const NOW = Date.parse("2026-10-24T00:00:00Z");
const SESSION = session(USER, { deadlineMs: NOW + 86_400_000 });
const buy: QuoteRequest = { series_id: SERIES.id, side: "buy", size: "1000000", signer: { standard: "nep413", signer_id: USER }, session: SESSION };
const bob: QuoteRequest = { ...buy, signer: { standard: "nep413", signer_id: "bob.test" }, session: session("bob.test", { deadlineMs: NOW + 86_400_000 }) };

type MmBehaviour = (premium: bigint) => Parameters<typeof mmSigned>[2] | "silent";

function setup(mmCount = 1, behaviour: MmBehaviour = () => ({})) {
  const { chain, executed, balances } = fakeChain();
  const statuses: unknown[] = [];
  const events: QuoteEvent[] = [];
  const auctions = new Auctions((event, mmId, response, receivedAt) => checkBid(chain, INTENTS, event, mmId, response, receivedAt));
  const ids = Array.from({ length: mmCount }, (_, i) => `mm${i}`);
  const mms: MarketMakers = {
    ids: () => ids,
    send: (mmId, message) => {
      if (message.method === "quote_status") return statuses.push(message.params);
      events.push(message.params);
      const premium = PREMIUM + BigInt(ids.indexOf(mmId));
      const options = behaviour(premium);
      if (options === "silent") return;
      queueMicrotask(() =>
        auctions.respond(mmId, { quote_id: message.params.quote_id, premium: premium.toString(), signed: mmSigned(message.params, premium, options) }),
      );
    },
  };
  const fills = new Fills(mkdtempSync(join(tmpdir(), "relay-")));
  const relay = new Relay({ config: { INTENTS_ID: INTENTS, OPTIONS_ID: OPTIONS, QUOTE_ASSET: USDC }, chain, fills, auctions, mms });
  const quote = async (request: QuoteRequest = buy) => {
    const pending = relay.quote(request);
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    return pending;
  };
  return { relay, quote, chain, executed, balances, statuses, events, fills };
}

function sign(quote: Quote, change: (unsigned: Unsigned) => Unsigned = (u) => u): SignedPayload {
  const unsigned = change(structuredClone(quote.payload));
  return unsigned.standard === "nep413"
    ? { ...unsigned, public_key: "ed25519:user", signature: "ed25519:sig" }
    : { ...unsigned, signature: "secp256k1:sig" };
}

function editMessage(edit: (message: Record<string, unknown>) => void) {
  return (unsigned: Unsigned): Unsigned => {
    if (unsigned.standard !== "nep413") throw new Error("nep413 only");
    const message = JSON.parse(unsigned.payload.message);
    edit(message);
    return { ...unsigned, payload: { ...unsigned.payload, message: JSON.stringify(message) } };
  };
}

describe("relay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("issues the exact user leg and settles [mm, user] once", async () => {
    const { relay, quote, executed, statuses, fills } = setup(3);
    const q = await quote();
    expect(q.premium).toBe(PREMIUM.toString());
    const user = readPayload(q.payload);
    expect(user).toMatchObject({ signer_id: USER, verifying_contract: INTENTS });
    expect(user.intents).toEqual([{ intent: "token_diff", diff: { [USDC]: "-15000000", [OPTION]: "1000000" } }]);
    expect(Date.parse(user.deadline)).toBe(q.sign_by_ms);

    const update = await relay.publish({ quote_id: q.quote_id, signed: sign(q) });
    expect(update).toEqual({ quote_id: q.quote_id, status: "settled", tx_hash: "tx1" });
    const [mmLeg] = executed[0] ?? [];
    expect(Date.parse(readPayload(mmLeg!).deadline) - SIGN_MARGIN_MS).toBe(q.sign_by_ms);
    expect(statuses).toEqual([update]);
    expect(await fills.byAccount(USER)).toMatchObject([{ quote_id: q.quote_id, premium: "15000000", tx_hash: "tx1" }]);
    expect(await fills.byAccount("bob.test")).toEqual([]);
  });

  it("lists open series and those expired within the claim window, nothing older", async () => {
    const nowSec = NOW / 1000;
    const at = (id: string, expiry: number) => ({ ...SERIES, id, expiry });
    const all = [
      at("open", nowSec + 3_600),
      { ...at("other-width", nowSec + 3_600), width: "10000" },
      at("just-expired", nowSec),
      at("edge", nowSec - 7 * 86_400 + 1),
      at("old", nowSec - 7 * 86_400),
    ];
    const { relay, chain } = setup();
    chain.listSeries = async () => all;
    const listing = await relay.series();
    expect(listing.series.map((s) => [s.id, s.quotable])).toEqual([
      ["open", true],
      ["other-width", false],
      ["just-expired", false],
      ["edge", false],
    ]);
  });

  it("refuses to quote the same strike at a width no market maker lists", async () => {
    const { quote, chain } = setup();
    const other = { ...SERIES, id: "BTC-27NOV26-110000_110000d01-C", width: "10000" };
    chain.listSeries = async () => [SERIES, other];
    expect(await httpStatus(quote({ ...buy, series_id: other.id }))).toBe(409);
  });

  it("a seller gets the highest bid and an erc191 payload string", async () => {
    const { relay, quote } = setup(2);
    const signer = { standard: "erc191" as const, signer_id: "0x00000000000000000000000000000000000000aa" };
    const q = await quote({ ...buy, side: "sell", signer, session: session(signer.signer_id, { standard: "erc191" }) });
    expect(q.premium).toBe((PREMIUM + 1n).toString());
    expect(q.pay).toEqual({ asset: OPTION, amount: "1000000" });
    expect(q.payload.standard).toBe("erc191");
    expect(await relay.publish({ quote_id: q.quote_id, signed: sign(q) })).toMatchObject({ status: "settled" });
  });

  it("settles only once under concurrent publishes", async () => {
    const { relay, quote, executed } = setup();
    const q = await quote();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => relay.publish({ quote_id: q.quote_id, signed: sign(q) })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(executed).toHaveLength(1);
  });

  it("refuses a publish after sign_by_ms, then tells the MM the quote expired", async () => {
    const { relay, quote, executed, statuses } = setup();
    const q = await quote();
    const published = await quote(bob);
    await relay.publish({ quote_id: published.quote_id, signed: sign(published) });
    vi.setSystemTime(q.sign_by_ms + 1);
    expect(await httpStatus(relay.publish({ quote_id: q.quote_id, signed: sign(q) }))).toBe(410);
    await vi.runAllTimersAsync();
    expect(statuses).toEqual([expect.objectContaining({ status: "settled" }), { quote_id: q.quote_id, status: "expired" }]);
    expect(relay.status(q.quote_id).status).toBe("expired");
    expect(await httpStatus(relay.publish({ quote_id: q.quote_id, signed: sign(q) }))).toBe(410);
    expect(relay.status(published.quote_id).status).toBe("settled");
    expect(executed).toHaveLength(1);
  });

  it.each([
    ["diff", editMessage((m) => ((m.intents as { diff: Record<string, string> }[])[0]!.diff[USDC] = "-1"))],
    ["deadline", editMessage((m) => (m.deadline = new Date(Date.now() + 3_600_000).toISOString()))],
    ["signer", editMessage((m) => (m.signer_id = "mallory.test"))],
    ["extra intent", editMessage((m) => (m.intents as unknown[]).push({ intent: "transfer" }))],
    ["nonce", (u: Unsigned) => ({ ...u, payload: { ...(u.payload as object), nonce: Buffer.alloc(32).toString("base64") } }) as Unsigned],
    ["recipient", (u: Unsigned) => ({ ...u, payload: { ...(u.payload as object), recipient: "evil.test" } }) as Unsigned],
    ["standard", (u: Unsigned) => ({ standard: "erc191", payload: JSON.stringify(u.payload) }) as Unsigned],
  ])("refuses a user payload with a tampered %s and keeps the quote usable", async (_, tamper) => {
    const { relay, quote, executed } = setup();
    const q = await quote();
    expect(await httpStatus(relay.publish({ quote_id: q.quote_id, signed: sign(q, tamper) }))).toBe(400);
    expect(executed).toHaveLength(0);
    expect(await relay.publish({ quote_id: q.quote_id, signed: sign(q) })).toMatchObject({ status: "settled" });
  });

  it("reports a failed settlement to the user and the MM, without a fill", async () => {
    const { relay, quote, executed, statuses, fills } = setup();
    const q = await quote();
    const update = await relay.publish({ quote_id: q.quote_id, signed: { ...sign(q), signature: "ed25519:bad" } as SignedPayload });
    expect(update).toMatchObject({ status: "failed", reason: "invalid signature" });
    expect(statuses).toEqual([update]);
    expect(executed).toHaveLength(0);
    expect(await fills.byAccount(USER)).toEqual([]);
    expect(await httpStatus(relay.publish({ quote_id: q.quote_id, signed: sign(q) }))).toBe(409);
  });

  it("settles a trade whose execute call errored after it ran, by the user's nonce, and records the fill", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { relay, quote, chain, executed, statuses, fills } = setup();
    const execute = chain.execute;
    vi.spyOn(chain, "execute").mockImplementationOnce(async (batch) => {
      await execute(batch);
      throw new Error("Internal server error");
    });
    const nonceRead = vi.spyOn(chain, "isNonceUsed");
    const q = await quote();
    const update = await relay.publish({ quote_id: q.quote_id, signed: sign(q) });
    expect(update).toEqual({ quote_id: q.quote_id, status: "settled" });
    expect(nonceRead).toHaveBeenCalledWith(USER, readPayload(q.payload).nonce);
    expect(executed).toHaveLength(1);
    expect(statuses).toEqual([update]);
    expect(await fills.byAccount(USER)).toEqual([expect.objectContaining({ quote_id: q.quote_id, tx_hash: "" })]);
  });

  it("fails an errored execute only once a final block is past the deadline with the nonce unused, never on a read error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { relay, quote, chain, statuses, fills } = setup();
    vi.spyOn(chain, "execute").mockRejectedValueOnce(new Error("Request timeout"));
    const q = await quote();
    const deadline = Date.parse(readPayload(q.payload).deadline);
    vi.spyOn(chain, "finalTimeMs").mockImplementation(async () => {
      if (Date.now() > deadline + 5_000 && Date.now() < deadline + 12_000) throw new Error("rpc down");
      return Date.now() - 1_000;
    });
    let update: unknown;
    void relay.publish({ quote_id: q.quote_id, signed: sign(q) }).then((u) => (update = u));
    await vi.advanceTimersByTimeAsync(deadline + 11_000 - Date.now());
    expect(update).toBeUndefined();
    expect(relay.status(q.quote_id).status).toBe("settling");
    expect(statuses).toEqual([]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(update).toMatchObject({ quote_id: q.quote_id, status: "failed", reason: "Request timeout" });
    expect(statuses).toEqual([update]);
    expect(await fills.byAccount(USER)).toEqual([]);
  });

  it("refuses unknown quote ids and unknown series", async () => {
    const { relay, quote } = setup();
    expect(await httpStatus(relay.publish({ quote_id: "nope", signed: { standard: "erc191", payload: "{}", signature: "secp256k1:x" } }))).toBe(404);
    expect(() => relay.status("nope")).toThrow(HttpError);
    expect(await httpStatus(quote({ ...buy, series_id: "BTC-27NOV26-1-C" }))).toBe(404);
  });

  it("refuses to sell a size below min_write, which could never be collected gaslessly, but buys one back", async () => {
    const { quote } = setup();
    const dust = String(MIN_WRITE - 1n);
    expect(await httpStatus(quote({ ...buy, size: dust }))).toBe(400);
    await expect(quote({ ...buy, side: "sell", size: dust })).resolves.toMatchObject({ size: dust });
  });

  it("stops quoting at the contract's write cutoff", async () => {
    const { quote } = setup();
    const cutoffMs = (SERIES.expiry - WRITE_CUTOFF_SEC) * 1000;
    vi.setSystemTime(cutoffMs - 60_000);
    const request = { ...buy, session: session(USER) };
    await expect(quote(request)).resolves.toBeDefined();
    vi.setSystemTime(cutoffMs);
    expect(await httpStatus(quote(request))).toBe(409);
  });

  it("refuses signer ids the verifier can't parse", async () => {
    const { quote } = setup();
    const signer = { standard: "erc191" as const, signer_id: "0xABCDEF0000000000000000000000000000000000" };
    expect(await httpStatus(quote({ ...buy, signer }))).toBe(400);
  });

  it.each([
    ["a forged signature", () => ({ ...SESSION, signature: "ed25519:bad" }) as SignedPayload],
    ["an expired session", () => session(USER, { deadlineMs: Date.now() })],
    ["a deadline beyond 7 days", () => session(USER, { deadlineMs: Date.now() + 7 * 86_400_000 + 1 })],
    ["another signer's session", () => session("mallory.test")],
    ["another standard", () => session(USER, { standard: "erc191" })],
    ["a session with intents", () => nep413(payload(INTENTS, USER, Date.now() + 60_000, SALT, randomBytes(15), [tokenDiff({ [USDC]: -1n })]))],
    ["another verifier", () => session(USER, { verifyingContract: "evil.test" })],
  ])("refuses %s before asking any MM", async (_, make) => {
    const { quote, events } = setup();
    expect(await httpStatus(quote({ ...buy, session: make() }))).toBe(401);
    expect(events).toEqual([]);
  });

  it("verifies a session on-chain once and refuses it from its deadline", async () => {
    const { quote, chain } = setup();
    const simulate = vi.spyOn(chain, "simulate");
    const week = session(USER, { deadlineMs: Date.now() + 7 * 86_400_000 });
    await quote({ ...buy, session: week });
    await quote({ ...buy, session: week });
    expect(simulate.mock.calls.filter(([[signed]]) => signed === week)).toHaveLength(1);
    vi.setSystemTime(Date.parse(readPayload(week).deadline));
    expect(await httpStatus(quote({ ...buy, session: week }))).toBe(401);
  });

  it("an attacker can't use up a victim's quotes by naming them, and holds none without a balance", async () => {
    const { quote, balances, events } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM);
    balances.set(`mallory.test:${USDC}`, 0n);
    const mallory = { ...buy, signer: { standard: "nep413" as const, signer_id: "mallory.test" }, session: session("mallory.test") };
    for (let i = 0; i < 5; i++) expect(await httpStatus(quote({ ...buy, session: mallory.session }))).toBe(401);
    expect(await httpStatus(quote(mallory))).toBe(402);
    expect(events).toEqual([]);
    await expect(quote()).resolves.toMatchObject({ premium: PREMIUM.toString() });
  });

  it("gives each signer 4 quotes per market-maker quote life (25 s), counted only after their session checks out", async () => {
    const { quote, events } = setup();
    const mallory = session("mallory.test");
    for (let i = 0; i < 20; i++) await httpStatus(quote({ ...buy, session: mallory }));
    for (let i = 0; i < 4; i++) await expect(quote()).resolves.toBeDefined();
    const asked = events.length;
    expect(await httpStatus(quote())).toBe(429);
    expect(events).toHaveLength(asked);
    await expect(quote(bob)).resolves.toBeDefined();
    vi.advanceTimersByTime(25_000);
    await expect(quote()).resolves.toBeDefined();
  });

  it("doesn't count quotes that settle into trades against the signer's limit", async () => {
    const { relay, quote } = setup();
    for (let i = 0; i < 8; i++) {
      const q = await quote();
      expect(await relay.publish({ quote_id: q.quote_id, signed: sign(q) })).toMatchObject({ status: "settled" });
    }
    for (let i = 0; i < 4; i++) await expect(quote()).resolves.toBeDefined();
    expect(await httpStatus(quote())).toBe(429);
  });

  it("banks nothing past the window: a trade settling after the window resets gives no extra quote", async () => {
    const { relay, quote } = setup();
    await quote();
    vi.advanceTimersByTime(20_000);
    const late = await quote();
    vi.advanceTimersByTime(6_000);
    expect(await relay.publish({ quote_id: late.quote_id, signed: sign(late) })).toMatchObject({ status: "settled" });
    for (let i = 0; i < 4; i++) await expect(quote()).resolves.toBeDefined();
    expect(await httpStatus(quote())).toBe(429);
  });

  it("gives a slot back only to the window that charged it", async () => {
    const { relay, quote, chain } = setup();
    const execute = chain.execute;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(chain, "execute").mockImplementationOnce(async (batch) => {
      await held;
      return execute(batch);
    });
    await quote();
    vi.advanceTimersByTime(20_000);
    const late = await quote();
    const settling = relay.publish({ quote_id: late.quote_id, signed: sign(late) });
    vi.advanceTimersByTime(6_000);
    for (let i = 0; i < 4; i++) await expect(quote()).resolves.toBeDefined();
    release();
    expect(await settling).toMatchObject({ status: "settled" });
    expect(await httpStatus(quote())).toBe(429);
  });

  it("counts no refused quote, so a slot given back is usable at once", async () => {
    const { relay, quote, chain } = setup();
    const execute = chain.execute;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(chain, "execute").mockImplementationOnce(async (batch) => {
      await held;
      return execute(batch);
    });
    const first = await quote();
    const settling = relay.publish({ quote_id: first.quote_id, signed: sign(first) });
    for (let i = 0; i < 3; i++) await expect(quote()).resolves.toBeDefined();
    for (let i = 0; i < 3; i++) expect(await httpStatus(quote())).toBe(429);
    release();
    expect(await settling).toMatchObject({ status: "settled" });
    await expect(quote()).resolves.toBeDefined();
  });

  it("gives no extra quote after a failed settlement", async () => {
    const { relay, quote } = setup();
    for (let i = 0; i < 4; i++) {
      const q = await quote();
      expect(await relay.publish({ quote_id: q.quote_id, signed: { ...sign(q), signature: "ed25519:bad" } as SignedPayload })).toMatchObject({ status: "failed" });
    }
    expect(await httpStatus(quote())).toBe(429);
  });

  it("doesn't count a quote refused for lack of funds against the signer's limit", async () => {
    const { quote, balances } = setup();
    balances.set(`${USER}:${USDC}`, 0n);
    for (let i = 0; i < 6; i++) expect(await httpStatus(quote())).toBe(402);
    balances.set(`${USER}:${USDC}`, 10n ** 12n);
    await expect(quote()).resolves.toBeDefined();
  });

  it("asks no market maker for a buyer who can't pay the $1 minimum premium", async () => {
    const { quote, balances, events } = setup();
    balances.set(`${USER}:${USDC}`, 999_999n);
    expect(await httpStatus(quote())).toBe(402);
    expect(events).toEqual([]);
    balances.set(`${USER}:${USDC}`, 1_000_000n);
    expect(await httpStatus(quote())).toBe(402);
    expect(events).toHaveLength(1);
  });

  it("refuses a buy the balance can't pay at the winning premium and frees the winner's inventory at once", async () => {
    const { quote, balances, statuses, events } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM - 1n);
    expect(await httpStatus(quote())).toBe(402);
    expect(statuses).toEqual([{ quote_id: events[0]!.quote_id, status: "expired" }]);
  });

  it("re-quoting expires the signer's own open quote, so it needs one premium, not two", async () => {
    const { relay, quote, balances, statuses } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM + PREMIUM / 2n);
    const other = await quote(bob);
    const first = await quote();
    await expect(quote()).resolves.toBeDefined();
    expect(statuses).toEqual([{ quote_id: first.quote_id, status: "expired" }]);
    expect(await httpStatus(relay.publish({ quote_id: first.quote_id, signed: sign(first) }))).toBe(410);
    expect(relay.status(other.quote_id).status).toBe("open");
  });

  it("keeps the old quote signable while its replacement is still in auction", async () => {
    let silent = false;
    const { relay, quote, balances, executed } = setup(1, () => (silent ? "silent" : {}));
    balances.set(`${USER}:${USDC}`, PREMIUM + PREMIUM / 2n);
    const first = await quote();
    silent = true;
    const next = relay.quote(buy);
    next.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS / 2);
    expect((await relay.publish({ quote_id: first.quote_id, signed: sign(first) })).status).toBe("settled");
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    expect(executed).toHaveLength(1);
  });

  it("counts a quote published during the post-auction balance read", async () => {
    const { relay, quote, chain, balances } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM + PREMIUM / 2n);
    vi.spyOn(chain, "execute").mockReturnValue(new Promise(() => {}));
    const first = await quote();
    const balanceOf = chain.balanceOf;
    let calls = 0;
    let release = () => {};
    vi.spyOn(chain, "balanceOf").mockImplementation(async (account, asset) => {
      if (++calls === 2) await new Promise<void>((resolve) => (release = resolve));
      return balanceOf(account, asset);
    });
    const next = relay.quote(buy);
    next.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    void relay.publish({ quote_id: first.quote_id, signed: sign(first) });
    release();
    expect(await httpStatus(next)).toBe(402);
  });

  it("keeps holding a quote's premium while it settles", async () => {
    const { relay, quote, chain, balances } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM + PREMIUM / 2n);
    vi.spyOn(chain, "execute").mockReturnValueOnce(new Promise(() => {}));
    const q = await quote();
    void relay.publish({ quote_id: q.quote_id, signed: sign(q) });
    expect(relay.status(q.quote_id).status).toBe("settling");
    expect(await httpStatus(quote())).toBe(402);
  });

  it("leaves one open quote per signer under concurrent requests, and frees every other MM", async () => {
    const { relay, balances, statuses, events } = setup();
    balances.set(`${USER}:${USDC}`, PREMIUM + PREMIUM / 2n);
    const pending = Array.from({ length: 4 }, () => relay.quote(buy));
    for (const p of pending) p.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    await Promise.allSettled(pending);
    const open = events.map((e) => e.quote_id).filter((id) => relay.status(id).status === "open");
    expect(open).toHaveLength(1);
    const others = events.map((e) => e.quote_id).filter((id) => !open.includes(id));
    expect(statuses).toEqual(expect.arrayContaining(others.map((quote_id) => ({ quote_id, status: "expired" }))));
    expect(statuses).toHaveLength(others.length);
  });

  it("caps sells at the options held before asking any MM", async () => {
    const { quote, balances, events } = setup();
    balances.set(`${USER}:${OPTION}`, 1_500_000n);
    const sell = { ...buy, side: "sell" as const };
    expect(await httpStatus(quote({ ...sell, size: "1500001" }))).toBe(402);
    expect(events).toEqual([]);
    await expect(quote({ ...sell, size: "1500000" })).resolves.toBeDefined();
  });

  it("answers 503 when no MM is online or every quote is invalid", async () => {
    expect(await httpStatus(setup(0).quote())).toBe(503);
    expect(await httpStatus(setup(2, () => ({ deadlineMs: Date.now() + 120_000 })).quote())).toBe(503);
    expect(await httpStatus(setup(1, () => "silent").quote())).toBe(503);
  });
});
