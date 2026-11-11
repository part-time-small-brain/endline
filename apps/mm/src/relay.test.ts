import type { AddressInfo } from "node:net";
import { MmMessage, type QuoteEvent } from "@endline/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { PUT, quoteEvent } from "./fixtures/desk.ts";
import { PING_MS, RelayClient } from "./relay.ts";

let server: WebSocketServer | undefined;
afterEach(() => {
  vi.useRealTimers();
  server?.close();
});

function relay(options: { autoPong?: boolean } = {}) {
  server = new WebSocketServer({ port: 0, ...options });
  const { port } = server.address() as AddressInfo;
  const connections: number[] = [];
  server.on("connection", () => connections.push(Date.now()));
  return { server, url: `ws://127.0.0.1:${port}/mm`, connections };
}

describe("relay client", () => {
  it("authenticates with a bearer header, never in the URL, skips malformed frames and answers and publishes marks in the relay's MmMessage shape", async () => {
    server = new WebSocketServer({ port: 0 });
    const { port } = server.address() as AddressInfo;
    const received: unknown[] = [];
    const requests: { url: string | undefined; authorization: string | undefined }[] = [];
    server.on("connection", (socket, request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      socket.on("message", (data) => received.push(JSON.parse(data.toString())));
      socket.send("not json");
      socket.send(JSON.stringify({ method: "quote", params: { quote_id: "missing fields" } }));
      socket.send(JSON.stringify({ method: "quote", params: quoteEvent(PUT, "buy", 1_000_000n, { quote_id: "q1" }) }));
    });

    const quotes: QuoteEvent[] = [];
    const client = new RelayClient(`ws://127.0.0.1:${port}/mm`, "secret key with spaces&=", { quote: (ev) => quotes.push(ev), status: () => {} }, () => {});
    client.start();
    await expect.poll(() => quotes.length).toBe(1);
    client.send({ quote_id: "q1", premium: "30000000", signed: { standard: "erc191", payload: "{}", signature: "secp256k1:s" } });
    client.publish([{ series_id: PUT.id, ask: "650000000", max_size: "100000000", vol: 0.4 }]);
    await expect.poll(() => received.length).toBe(2);
    client.close();

    expect(requests).toEqual([{ url: "/mm", authorization: "Bearer secret key with spaces&=" }]);
    expect(quotes[0]?.quote_id).toBe("q1");
    expect(received.map((m) => MmMessage.parse(m))).toEqual(received);
    expect(received[1]).toMatchObject({ method: "marks", params: [{ series_id: PUT.id }] });
  });

  it("drops a relay that sends a frame over 64 KB, without handling it, and reconnects", async () => {
    const { server, url, connections } = relay();
    server.on("connection", (socket) => {
      if (connections.length === 1) socket.send(JSON.stringify({ method: "quote", params: quoteEvent(PUT, "buy", 1_000_000n, { quote_id: "x".repeat(70_000) }) }));
    });
    const quotes: QuoteEvent[] = [];
    const client = new RelayClient(url, "k", { quote: (ev) => quotes.push(ev), status: () => {} }, () => {});
    client.start();
    await expect.poll(() => connections.length, { timeout: 5_000 }).toBe(2);
    client.close();
    expect(quotes).toEqual([]);
  }, 10_000);

  it("drops a relay that stops answering pings and reconnects", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const { url, connections } = relay({ autoPong: false });
    const client = new RelayClient(url, "k", { quote: () => {}, status: () => {} }, () => {});
    client.start();
    await expect.poll(() => connections.length).toBe(1);
    vi.advanceTimersByTime(PING_MS);
    vi.advanceTimersByTime(PING_MS);
    await expect.poll(() => connections.length, { timeout: 5_000 }).toBe(2);
    client.close();
  }, 10_000);
});
