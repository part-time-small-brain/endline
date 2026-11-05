import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AccountId, PublishRequest, QuoteRequest, SignedRequest } from "@endline/sdk";
import { z } from "zod";
import type { Collector } from "./collect.ts";
import type { Faucet } from "./faucet.ts";
import type { Fills } from "./fills.ts";
import { parseJson } from "./json.ts";
import { clientKey, rateLimit } from "./limit.ts";
import type { MmHub } from "./mm.ts";
import type { OneClick } from "./oneClick.ts";
import { HttpError, type Relay } from "./relay.ts";

const MAX_BODY_BYTES = 64 * 1024;
const LIMITED = new Set(["POST /quote", "POST /execute", "POST /transfer", "POST /claims", "POST /faucet", "POST /deposit-quote"]);
const SAME_ORIGIN = new Set(["/faucet", "/deposit-quote"]);
const MAX_REQUESTS_PER_MINUTE = 30;
const FaucetRequest = z.object({ account_id: AccountId });
const FAUCET_IPV6_GROUPS = 3;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

async function parseBody<T>(request: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body too large");
    chunks.push(chunk);
  }
  const body = parseJson(Buffer.concat(chunks).toString("utf8"));
  if (body === undefined) throw new HttpError(400, "body is not valid JSON");
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, z.prettifyError(parsed.error));
  return parsed.data;
}

function decodePathPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new HttpError(400, "bad path");
  }
}

function pathOf(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "/", "http://relay").pathname;
  } catch {
    return undefined;
  }
}

function isJson(request: IncomingMessage): boolean {
  return request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function send(response: ServerResponse, status: number, body: unknown, cors: object): void {
  response.writeHead(status, { ...cors, "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createRelayServer(relay: Relay, fills: Fills, hub: MmHub, collector: Collector, oneClick: OneClick, faucet?: Faucet, trustProxy = false): Server {
  const allow = rateLimit(MAX_REQUESTS_PER_MINUTE, 60_000);
  const route = async (request: IncomingMessage): Promise<[number, unknown]> => {
    const path = pathOf(request);
    if (path === undefined) throw new HttpError(400, "bad url");
    const [, head, arg, extra] = path.split("/");
    if (extra !== undefined) throw new HttpError(404, "not found");
    const param = arg === undefined ? "" : decodePathPart(arg);
    const endpoint = `${request.method} /${head}${arg === undefined ? "" : "/:arg"}`;
    if (LIMITED.has(endpoint) && !allow(clientKey(request, trustProxy))) throw new HttpError(429, "too many requests");

    switch (endpoint) {
      case "GET /health":
        return [200, { ok: true, market_makers: hub.ids().length, relayer_id: collector.feeAccount }];
      case "GET /series":
        return [200, await relay.series()];
      case "GET /marks":
        return [200, hub.marks.best(Date.now())];
      case "POST /quote":
        return [200, await relay.quote(await parseBody(request, QuoteRequest))];
      case "POST /publish": {
        const update = await relay.publish(await parseBody(request, PublishRequest));
        return [update.status === "settled" ? 200 : 422, update];
      }
      case "POST /execute":
        return [200, { tx_hash: await collector.execute((await parseBody(request, SignedRequest)).signed) }];
      case "POST /transfer":
        return [200, { tx_hash: await collector.transfer((await parseBody(request, SignedRequest)).signed) }];
      case "POST /claims":
        await collector.claim((await parseBody(request, SignedRequest)).signed);
        return [200, { ok: true }];
      case "POST /faucet":
        if (!faucet) throw new HttpError(403, "the faucet is off on this network");
        if (!isJson(request)) throw new HttpError(415, "send application/json");
        return [200, { tx_hash: await faucet.drip((await parseBody(request, FaucetRequest)).account_id, clientKey(request, trustProxy, FAUCET_IPV6_GROUPS)) }];
      case "POST /deposit-quote":
        if (!isJson(request)) throw new HttpError(415, "send application/json");
        return [200, await oneClick.quote(await parseBody(request, oneClick.schema))];
      case "GET /status/:arg":
        return [200, relay.status(param)];
      case "GET /fills/:arg":
        if (!AccountId.safeParse(param).success) throw new HttpError(400, "invalid account id");
        return [200, await fills.byAccount(param)];
      default:
        throw new HttpError(404, "not found");
    }
  };

  const server = createServer((request, response) => {
    const cors = SAME_ORIGIN.has(pathOf(request) ?? "") ? {} : CORS;
    if (request.method === "OPTIONS") {
      response.writeHead(204, cors).end();
      return;
    }
    route(request)
      .then(([status, body]) => send(response, status, body, cors))
      .catch((error: unknown) => {
        if (error instanceof HttpError) return send(response, error.status, { error: error.message }, cors);
        console.error(error);
        send(response, 500, { error: "internal error" }, cors);
      });
  });

  server.on("upgrade", (request, socket, head) => {
    socket.on("error", () => socket.destroy());
    if (pathOf(request) === "/mm") hub.upgrade(request, socket, head);
    else socket.destroy();
  });
  return server;
}
