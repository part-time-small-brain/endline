import { mkdtempSync } from "node:fs";
import { type AddressInfo, connect as rawConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Quote, QuoteEvent } from "@near-options/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { Auctions } from "./auction.ts";
import { checkBid } from "./bid.ts";
import { Claims } from "./claims.ts";
import { Collector } from "./collect.ts";
import { Faucet } from "./faucet.ts";
import { Fills } from "./fills.ts";
import { MmHub } from "./mm.ts";
import { OneClick } from "./oneClick.ts";
import { Relay } from "./relay.ts";
import { createRelayServer } from "./server.ts";
import { DEPOSIT, fakeChain, INTENTS, mmSigned, OPTIONS, SERIES, SIGNED_QUOTE, session, USDC } from "./test-fakes.ts";

const KEY = "test-key-0123456789";
const { chain } = fakeChain([{ ...SERIES, expiry: Math.floor(Date.now() / 1000) + 86_400 }]);
const fills = new Fills(mkdtempSync(join(tmpdir(), "relay-")));
const auctions = new Auctions((event, mmId, response, receivedAt) => checkBid(chain, INTENTS, event, mmId, response, receivedAt));
const hub = new MmHub([KEY], (mmId, response) => auctions.respond(mmId, response));
const relay = new Relay({ config: { INTENTS_ID: INTENTS, OPTIONS_ID: OPTIONS, QUOTE_ASSET: USDC }, chain, fills, auctions, mms: hub });
const collector = new Collector(chain, { INTENTS_ID: INTENTS, OPTIONS_ID: OPTIONS, QUOTE_ASSET: USDC, RELAYER_ACCOUNT_ID: "relayer.test" }, new Claims(mkdtempSync(join(tmpdir(), "relay-"))), fills);
const oneClick = new OneClick(DEPOSIT.destinationAsset, "jwt");
const server = createRelayServer(relay, fills, hub, collector, oneClick);
let base = "";
const sockets: WebSocket[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
});

const post = (path: string, body: string) =>
  fetch(`http://${base}${path}`, { method: "POST", body, headers: { "content-type": "application/json" } });

function raw(request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const [host, port] = base.split(":");
    const socket = rawConnect(Number(port), host, () => socket.write(request));
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
  });
}

function connect(key: string, path = "/mm"): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${base}${path}?key=${encodeURIComponent(key)}`);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("unexpected-response", (_, response) => reject(new Error(`http ${response.statusCode}`)));
    socket.once("error", reject);
  });
}

describe("http", () => {
  it("answers CORS preflights", async () => {
    const response = await fetch(`http://${base}/quote`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each([
    ["malformed JSON", "/quote", "{", 400],
    ["a request that fails the schema", "/quote", JSON.stringify({ series_id: SERIES.id, side: "buy", size: "-1" }), 400],
    ["an execute with a malformed signed payload", "/execute", JSON.stringify({ signed: { standard: "nep413" } }), 400],
    ["a transfer of nothing", "/transfer", JSON.stringify({ signed: session("alice.test") }), 400],
    ["a claim that is not a close", "/claims", JSON.stringify({ signed: { standard: "erc191", payload: "{}", signature: "secp256k1:x" } }), 400],
    ["an oversized body", "/publish", JSON.stringify({ pad: "x".repeat(70_000) }), 413],
    ["an unknown route", "/quote/extra", "{}", 404],
  ])("rejects %s", async (_, path, body, status) => {
    const response = await post(path, body);
    expect(response.status).toBe(status);
    expect(await response.json()).toHaveProperty("error");
  });

  it("answers a url it can't parse with 400 and keeps serving", async () => {
    expect(await raw("GET //a:99999 HTTP/1.1\r\nHost: relay\r\nConnection: close\r\n\r\n")).toMatch(/^HTTP\/1\.1 400/);
    expect((await fetch(`http://${base}/health`)).status).toBe(200);
  });

  it("rate limits quote, execute, transfer and claims per IP in a fixed window", async () => {
    const limited = createRelayServer(relay, fills, hub, collector, oneClick);
    await new Promise<void>((resolve) => limited.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
    const statusOf = async (path: string) => (await fetch(`${url}${path}`, { method: "POST", body: "{" })).status;
    try {
      const paths = ["/quote", "/execute", "/transfer", "/claims"];
      for (let i = 0; i < 30; i++) expect(await statusOf(paths[i % paths.length]!)).toBe(400);
      expect(await statusOf("/quote")).toBe(429);
      expect(await statusOf("/transfer")).toBe(429);
      expect(await statusOf("/faucet")).toBe(429);
      expect(await statusOf("/deposit-quote")).toBe(429);
      expect(await statusOf("/publish")).toBe(400);
      expect((await fetch(`${url}/health`)).status).toBe(200);
      vi.setSystemTime(Date.now() + 60_000);
      expect(await statusOf("/claims")).toBe(400);
    } finally {
      vi.useRealTimers();
      await new Promise((resolve) => limited.close(resolve));
    }
  });

  it("refuses a /deposit-quote a page on another origin could send without a preflight", async () => {
    const response = await fetch(`http://${base}/deposit-quote`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(415);
  });

  it("forwards a valid /deposit-quote to 1Click and answers its quote", async () => {
    const realFetch = globalThis.fetch;
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(SIGNED_QUOTE), { status: 201 }));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).startsWith("https://1click") ? upstream(url, init) : realFetch(url, init)));
    try {
      const response = await post("/deposit-quote", JSON.stringify(DEPOSIT));
      expect([response.status, await response.json()]).toEqual([200, SIGNED_QUOTE]);
      expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-api-key": "jwt" });
      expect((await post("/deposit-quote", JSON.stringify({ ...DEPOSIT, appFees: [] }))).status).toBe(400);
      expect(upstream).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("answers 403 on /faucet when the faucet is off", async () => {
    expect((await post("/faucet", JSON.stringify({ account_id: "alice.testnet" }))).status).toBe(403);
  });

  it("drips to a valid account, keyed by the client IP the proxy saw, one per IPv6 /48", async () => {
    const sent: string[] = [];
    const faucet = new Faucet(async (accountId) => {
      sent.push(accountId);
      return "tx";
    }, mkdtempSync(join(tmpdir(), "relay-")));
    const withFaucet = createRelayServer(relay, fills, hub, collector, oneClick, faucet, true);
    await new Promise<void>((resolve) => withFaucet.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(withFaucet.address() as AddressInfo).port}`;
    const drip = (accountId: string, ip: string, contentType = "application/json") =>
      fetch(`${at}/faucet`, { method: "POST", body: JSON.stringify({ account_id: accountId }), headers: { "content-type": contentType, "x-forwarded-for": ip } });
    const evm = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    try {
      for (const bad of ["NOT AN ACCOUNT", evm.toUpperCase().replace("0X", "0x"), ""]) expect((await drip(bad, "1.1.1.1")).status).toBe(400);
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) expect((await drip("carol.testnet", "3.3.3.3", type)).status).toBe(415);
      const response = await drip(evm, "1.1.1.1");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ tx_hash: "tx" });
      expect((await drip("bob.testnet", "1.1.1.1")).status).toBe(429);
      expect((await drip("bob.testnet", "2.2.2.2", "Application/JSON; charset=utf-8")).status).toBe(200);
      expect((await drip("carol.testnet", "2001:db8:1:1::1")).status).toBe(200);
      expect((await drip("dave.testnet", "2001:db8:1:ffff::1")).status).toBe(429);
      expect((await drip("dave.testnet", "2001:db8:2::1")).status).toBe(200);
      expect(sent).toEqual([evm, "bob.testnet", "carol.testnet", "dave.testnet"]);
    } finally {
      await new Promise((resolve) => withFaucet.close(resolve));
    }
  });

  it.each(["/faucet", "/deposit-quote"])("keeps %s same-origin: no CORS on it or its preflight", async (path) => {
    for (const init of [{ method: "OPTIONS" }, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }]) {
      const response = await fetch(`http://${base}${path}`, init);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect((await fetch(`http://${base}/series`)).headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each([
    ["/fills/NOT%20AN%20ACCOUNT", 400],
    ["/fills/%E0%A4%A", 400],
    ["/status/unknown", 404],
    ["/nope", 404],
  ])("GET %s answers %i", async (path, status) => {
    expect((await fetch(`http://${base}${path}`)).status).toBe(status);
  });
});

describe("market maker socket", () => {
  it.each([["a wrong key", "wrong-key-0123456789"], ["no key", ""]])("refuses %s", async (_, key) => {
    await expect(connect(key)).rejects.toThrow("http 401");
  });

  it("survives a refused upgrade whose client resets before the answer", async () => {
    for (let i = 0; i < 20; i++) {
      const [host, port] = base.split(":");
      const socket = rawConnect(Number(port), host, () => {
        socket.write("GET /mm?key=wrong HTTP/1.1\r\nHost: relay\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
        socket.resetAndDestroy();
      });
      socket.on("error", () => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await fetch(`http://${base}/health`)).status).toBe(200);
  });

  it("refuses upgrades on other paths", async () => {
    await expect(connect(KEY, "/other")).rejects.toThrow();
  });

  it("runs a full quote, publish and status round trip", async () => {
    const mm = await connect(KEY);
    const received: { method: string; params: unknown }[] = [];
    mm.on("message", (data) => {
      const message = JSON.parse(data.toString());
      received.push(message);
      if (message.method !== "quote") return;
      const event = message.params as QuoteEvent;
      mm.send("not json");
      mm.send(JSON.stringify({ method: "quote_response", params: { quote_id: event.quote_id, premium: "15000000", signed: mmSigned(event, 15_000_000n) } }));
    });
    expect(await (await fetch(`http://${base}/health`)).json()).toEqual({ ok: true, market_makers: 1, relayer_id: "relayer.test" });

    const signer = { standard: "nep413", signer_id: "alice.test" };
    const quoteResponse = await post("/quote", JSON.stringify({ series_id: SERIES.id, side: "buy", size: "1000000", signer, session: session("alice.test") }));
    expect(quoteResponse.status).toBe(200);
    const quote = (await quoteResponse.json()) as Quote;

    const signed = { ...quote.payload, public_key: "ed25519:user", signature: "ed25519:sig" };
    const publish = await post("/publish", JSON.stringify({ quote_id: quote.quote_id, signed }));
    expect(publish.status).toBe(200);
    expect(await publish.json()).toMatchObject({ status: "settled" });
    expect((await post("/publish", JSON.stringify({ quote_id: quote.quote_id, signed }))).status).toBe(409);

    expect(await (await fetch(`http://${base}/status/${quote.quote_id}`)).json()).toMatchObject({ status: "settled" });
    expect(await (await fetch(`http://${base}/fills/alice.test`)).json()).toMatchObject([{ quote_id: quote.quote_id }]);
    await expect.poll(() => received.map((m) => m.method)).toEqual(["quote", "quote_status"]);
  });

  it("serves the best marks across connected market makers on GET /marks, with CORS, and drops a market maker's marks when it disconnects", async () => {
    const [a, b] = await Promise.all([connect(KEY), connect(KEY)]);
    const marks = async () => {
      const response = await fetch(`http://${base}/marks`);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      return response.json();
    };
    a.send(JSON.stringify({ method: "marks", params: [{ series_id: SERIES.id, ask: "30000000", bid: "10000000", vol: 0.4 }] }));
    b.send(JSON.stringify({ method: "marks", params: [{ series_id: SERIES.id, ask: "25000000", bid: "8000000", vol: 0.5 }] }));
    await expect.poll(marks).toEqual([{ series_id: SERIES.id, ask: "25000000", bid: "10000000", vol: 0.5 }]);
    b.close();
    await expect.poll(marks).toEqual([{ series_id: SERIES.id, ask: "30000000", bid: "10000000", vol: 0.4 }]);
    a.close();
    await expect.poll(marks).toEqual([]);
  });
});
