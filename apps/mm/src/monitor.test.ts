import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { monitorCommand } from "./monitor.ts";

const NOW_SEC = 1_792_842_000;
const EXPIRY = NOW_SEC - 300;

const chain = vi.hoisted(() => ({ settlement: vi.fn(), series: vi.fn(), nearBalance: vi.fn(), pendingChanges: vi.fn() }));
const sleep = vi.hoisted(() => vi.fn());

vi.mock("node:timers/promises", () => ({ setTimeout: sleep }));

vi.mock("./chain.ts", () => ({
  ChainReader: class {
    settlementTerms = async () => ({ ownerId: "owner.testnet", oracles: ["oracle.testnet"], quoteDecimals: 6, oracleWindowSec: 600 });
    underlyings = async () => [{ symbol: "BTC", index: "btc_usd" }];
    series = chain.series;
    settlement = chain.settlement;
    nearBalance = chain.nearBalance;
    pendingChanges = chain.pendingChanges;
  },
}));

const CONFIG = {
  rpc: { urls: ["https://rpc"], network: "testnet" },
  optionsId: "opt.testnet",
  intentsId: "intents.testnet",
  relayerId: "relayer.testnet" as string | undefined,
  mmId: undefined as string | undefined,
  networkId: "testnet" as const,
  webhookUrl: "https://hooks.example/x" as string | undefined,
  healthUrl: undefined as string | undefined,
};
const NEAR = 10n ** 24n;

beforeEach(() => {
  sleep.mockReset();
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "opt.testnet" ? NEAR / 10n : 10n * NEAR, storageUsage: 0 }));
  chain.pendingChanges.mockResolvedValue({ oracles: [], oracle_wasm: null, pending_owner_id: null });
  vi.spyOn(Date, "now").mockReturnValue(NOW_SEC * 1000);
  vi.spyOn(console, "error").mockImplementation(() => {});
  chain.series.mockResolvedValue([
    { underlying: "BTC", expiry: EXPIRY, id: "call" },
    { underlying: "BTC", expiry: EXPIRY, id: "put" },
    { underlying: "BTC", expiry: NOW_SEC + 60, id: "live" },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("alerts an unverifiable proposal when Deribit is down and keeps posting after a webhook failure", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.settlement.mockResolvedValue({ price: "80000000000", final_at: NOW_SEC + 60, proposed_by: "outlayer.testnet" });
  const hooks: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("deribit")) return new Response("", { status: 503 });
      hooks.push(JSON.parse(String(init?.body)));
      return new Response("", { status: hooks.length === 1 ? 500 : 200 });
    }),
  );

  await monitorCommand(CONFIG, true);

  expect(chain.settlement).toHaveBeenCalledExactlyOnceWith("BTC", EXPIRY);
  const alerts = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"));
  expect(alerts).toHaveLength(2);
  expect(alerts[0]).toContain("no Deribit reference");
  expect(alerts[1]).toContain("0.100 NEAR above storage");
  expect(hooks).toHaveLength(2);
  const message = "🔴 testnet · Options contract low on NEAR\nopt.testnet: 0.100 NEAR above storage, below the 0.300 NEAR reserve. Top it up";
  expect(hooks[1]).toEqual({ text: message, content: message });
});

function ticks(n: number, config = CONFIG) {
  sleep.mockImplementation(async () => {
    if (sleep.mock.calls.length === n) throw new Error("stop");
  });
  return expect(monitorCommand(config, false)).rejects.toThrow("stop");
}

function webhook(down: boolean[] = []) {
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("deribit")) return new Response("", { status: 503 });
      const { text } = JSON.parse(String(init?.body));
      const failed = down[sleep.mock.calls.length] ?? false;
      posted.push(`${failed ? "failed" : "ok"} ${text.split("\n")[0]}`);
      return new Response("", { status: failed ? 502 : 200 });
    }),
  );
  return posted;
}

it("says a flagged price went final instead of calling it resolved", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.nearBalance.mockResolvedValue({ amount: 10n * NEAR, storageUsage: 0 });
  chain.settlement.mockResolvedValue({ price: "80000000000", final_at: NOW_SEC + 60, proposed_by: "outlayer.testnet" });
  vi.spyOn(Date, "now").mockImplementation(() => (NOW_SEC + 60 * sleep.mock.calls.length) * 1000);
  const posted = webhook();
  await ticks(3);
  const title = `Can't check the settlement price for BTC ${new Date(EXPIRY * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  expect(posted).toEqual([`ok 🔴 testnet · ${title}`, `ok ⚠️ testnet · Final: ${title}`]);
});

it("never resolves an alert that cleared before any post of it got through", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const relayer = [NEAR, 10n * NEAR, 10n * NEAR];
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "relayer.testnet" ? relayer[sleep.mock.calls.length] : 10n * NEAR, storageUsage: 0 }));
  const posted = webhook([true]);
  await ticks(3);
  expect(posted).toEqual(["failed 🔴 testnet · Relayer low on NEAR"]);
});

it("retries an alert and its resolution until the webhook takes them, and posts each once", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const relayer = [NEAR, NEAR, NEAR, 10n * NEAR, NEAR, 10n * NEAR, 10n * NEAR];
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "relayer.testnet" ? relayer[sleep.mock.calls.length] : 10n * NEAR, storageUsage: 0 }));
  const posted = webhook([true, false, false, true]);
  await ticks(relayer.length);
  expect(posted).toEqual(["failed 🔴 testnet · Relayer low on NEAR", "ok 🔴 testnet · Relayer low on NEAR", "failed ✅ testnet · Resolved: Relayer low on NEAR", "ok ✅ testnet · Resolved: Relayer low on NEAR"]);
});

it("threads a resolution under its Telegram alert and says how long it lasted", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const relayer = [NEAR, NEAR, 10n * NEAR];
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "relayer.testnet" ? relayer[sleep.mock.calls.length] : 10n * NEAR, storageUsage: 0 }));
  vi.spyOn(Date, "now").mockImplementation(() => (NOW_SEC + 47 * 60 * sleep.mock.calls.length) * 1000);
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: 40 + bodies.length } });
    }),
  );
  await ticks(relayer.length);
  expect(bodies).toEqual([
    expect.not.objectContaining({ reply_parameters: expect.anything() }),
    expect.objectContaining({ text: "✅ testnet · Resolved: Relayer low on NEAR\nLasted 1 h 34 min", reply_parameters: { message_id: 41, allow_sending_without_reply: true } }),
  ]);
});

it("never adds reply_parameters for a webhook that returns no message id, like Slack or Discord", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const relayer = [NEAR, 10n * NEAR];
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "relayer.testnet" ? relayer[sleep.mock.calls.length] : 10n * NEAR, storageUsage: 0 }));
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("ok", { status: 200 });
    }),
  );
  await ticks(relayer.length);
  expect(bodies.map((b) => Object.keys(b))).toEqual([["text", "content"], ["text", "content"]]);
});

it("skips Deribit for an unsettled expiry inside the oracle window", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.settlement.mockResolvedValue(null);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ result: [] })));
  vi.stubGlobal("fetch", fetch);
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(chain.settlement).toHaveBeenCalledExactlyOnceWith("BTC", EXPIRY);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads expiries one at a time and fetches each index chart once per check", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const expiries = Array.from({ length: 20 }, (_, i) => EXPIRY - 60 * i);
  chain.series.mockResolvedValue(expiries.map((expiry) => ({ underlying: "BTC", expiry, id: String(expiry) })));
  let reading = 0;
  let mostAtOnce = 0;
  chain.settlement.mockImplementation(async () => {
    mostAtOnce = Math.max(mostAtOnce, ++reading);
    await Promise.resolve();
    reading--;
    return { price: "80000000000", final_at: NOW_SEC + 60, proposed_by: "outlayer.testnet" };
  });
  const fetch = vi.fn(async () => new Response(JSON.stringify({ result: [] })));
  vi.stubGlobal("fetch", fetch);
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(chain.settlement).toHaveBeenCalledTimes(20);
  expect(mostAtOnce).toBe(1);
  expect(fetch).toHaveBeenCalledOnce();
});

it("alerts the intents contract below 2 NEAR over storage and the relayer below 2 NEAR, each on its own", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const balances: Record<string, { amount: bigint; storageUsage: number }> = {
    "opt.testnet": { amount: 10n * NEAR, storageUsage: 0 },
    "intents.testnet": { amount: NEAR + 2n * NEAR, storageUsage: 100_000 },
    "relayer.testnet": { amount: 2n * NEAR - 1n, storageUsage: 0 },
  };
  chain.nearBalance.mockImplementation(async (accountId: string) => balances[accountId]);
  const alerts = async (config = CONFIG) => {
    log.mockClear();
    await monitorCommand({ ...config, webhookUrl: undefined }, true);
    return log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"));
  };

  expect(await alerts()).toEqual([expect.stringContaining("ALERT [testnet] Relayer low on NEAR: relayer.testnet: ")]);
  balances["intents.testnet"] = { amount: NEAR + 2n * NEAR - 1n, storageUsage: 100_000 };
  expect(await alerts()).toEqual([expect.stringContaining("ALERT [testnet] Intents contract low on NEAR: intents.testnet: "), expect.stringContaining("ALERT [testnet] Relayer low on NEAR: relayer.testnet: ")]);
  chain.nearBalance.mockClear();
  expect(await alerts({ ...CONFIG, relayerId: undefined })).toEqual([expect.stringContaining("ALERT [testnet] Intents contract low on NEAR: intents.testnet: ")]);
  expect(chain.nearBalance.mock.calls.map(([id]) => id)).toEqual(["opt.testnet", "intents.testnet"]);
});

it("holds the options contract to 0.3 NEAR over storage and the accounts that pay gas to 2 NEAR", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  const balances: Record<string, bigint> = { "opt.testnet": (3n * NEAR) / 10n, "intents.testnet": 10n * NEAR, "relayer.testnet": (3n * NEAR) / 10n };
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: balances[accountId], storageUsage: 0 }));
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"))).toEqual([expect.stringContaining("ALERT [testnet] Relayer low on NEAR: relayer.testnet: 0.300 NEAR above storage, below the 2.000 NEAR reserve")]);
  balances["opt.testnet"] = (3n * NEAR) / 10n - NEAR / 1000n;
  log.mockClear();
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"))[0]).toContain("Options contract low on NEAR: opt.testnet: 0.299 NEAR above storage, below the 0.300 NEAR reserve");
});

it("alerts the market maker running out of NEAR for gas once its account is set", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  chain.nearBalance.mockImplementation(async (accountId: string) => ({ amount: accountId === "mm.testnet" ? NEAR / 10n : 10n * NEAR, storageUsage: 0 }));
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"))).toEqual([]);
  await monitorCommand({ ...CONFIG, mmId: "mm.testnet", webhookUrl: undefined }, true);
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"))).toEqual([expect.stringContaining("ALERT [testnet] Market maker low on NEAR: mm.testnet: 0.100 NEAR above storage")]);
});

it("keeps settlement alerts flowing when one reserve account can't be read", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  chain.nearBalance.mockImplementation(async (accountId: string) => {
    if (accountId === "intents.testnet") throw new Error("account does not exist");
    return { amount: 10n * NEAR, storageUsage: 0 };
  });
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  const lines = log.mock.calls.map(([line]) => String(line));
  expect(lines.filter((line) => line.startsWith("ALERT"))).toEqual([expect.stringContaining("intents.testnet: can't read balance")]);
  expect(lines).toContain("monitor: 1 open alerts");
});

it("alerts each pending oracle, WASM and owner change once, holds them through a failed read and resolves each when it takes effect or is withdrawn", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  chain.nearBalance.mockResolvedValue({ amount: 10n * NEAR, storageUsage: 0 });
  const activeAt = NOW_SEC + 120;
  const wasm = { oracle_wasm: { outlayer_id: "outlayer.testnet", url: "https://x/oracle.wasm", sha256: "ab".repeat(32) }, active_at: activeAt };
  const all = { oracles: [["evil.testnet", activeAt]], oracle_wasm: wasm, pending_owner_id: "dao.testnet" };
  const pending = [all, null, all, { oracles: [], oracle_wasm: null, pending_owner_id: null }];
  chain.pendingChanges.mockImplementation(async () => pending[sleep.mock.calls.length] ?? Promise.reject(new Error("RPC timeout")));
  webhook();
  await ticks(pending.length);
  const at = `${new Date(activeAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => !line.startsWith("monitor:"))).toEqual([
    `ALERT [testnet] New oracle pending: opt.testnet: oracle evil.testnet pending, active at ${at}`,
    `ALERT [testnet] New oracle WASM pending: opt.testnet: oracle WASM ${"ab".repeat(32)} (https://x/oracle.wasm, outlayer.testnet) pending, active at ${at}`,
    "ALERT [testnet] New contract owner pending: opt.testnet: owner dao.testnet pending, takes over when it calls accept_owner",
    "RESOLVED [testnet] New oracle pending, after 0 min",
    "RESOLVED [testnet] New oracle WASM pending, after 0 min",
    "RESOLVED [testnet] New contract owner pending, after 0 min",
  ]);
});

it("keeps settlement alerts flowing when pending changes can't be read", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.nearBalance.mockResolvedValue({ amount: 10n * NEAR, storageUsage: 0 });
  chain.settlement.mockResolvedValue({ price: "80000000000", final_at: NOW_SEC + 60, proposed_by: "outlayer.testnet" });
  chain.pendingChanges.mockRejectedValue(new Error("RPC timeout"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
  await monitorCommand({ ...CONFIG, webhookUrl: undefined }, true);
  expect(log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("ALERT"))).toEqual([
    expect.stringContaining("no Deribit reference"),
    "ALERT [testnet] Can't read pending admin changes: opt.testnet: can't read pending changes: Error: RPC timeout",
  ]);
});

const HEALTH_URL = "http://web/health";
const MARKS_URL = "http://web/marks";
const healthy = (marketMakers: number) => async () => Response.json({ ok: true, market_makers: marketMakers });

function stack(replies: (() => Promise<Response>)[], marks: (() => Promise<Response>)[] = []) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  chain.nearBalance.mockResolvedValue({ amount: 10n * NEAR, storageUsage: 0 });
  const posted: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === HEALTH_URL) return replies[sleep.mock.calls.length]?.();
      if (url === MARKS_URL) return (marks[sleep.mock.calls.length] ?? (async () => Response.json([{ series_id: "x" }])))();
      posted.push(JSON.parse(String(init?.body)).text);
      return new Response("", { status: 200 });
    }),
  );
  return { posted, run: () => ticks(replies.length, { ...CONFIG, healthUrl: HEALTH_URL }) };
}

it.each([
  ["an error status", async () => new Response("", { status: 502 })],
  ["a page that isn't /health", async () => new Response("<!doctype html>", { status: 200 })],
  ["ok: false", async () => Response.json({ ok: false, market_makers: 1 })],
  ["a refused connection", async () => Promise.reject(new TypeError("fetch failed"))],
])("alerts the stack down once on %s and resolves it when /health is ok with a market maker", async (_, down) => {
  const { posted, run } = stack([down, down, healthy(1)]);
  await run();
  expect(posted).toEqual([expect.stringMatching(/^🔴 testnet · Relay down\nhttp:\/\/web\/health: /), "✅ testnet · Resolved: Relay down\nLasted 0 min"]);
});

it("alerts no market maker on its own, keeps it open while the stack is down, and resolves uptime when the relay is back and quotes when an MM connects", async () => {
  const down = async () => new Response("", { status: 502 });
  const { posted, run } = stack([healthy(0), healthy(0), down, down, healthy(0), healthy(1)]);
  await run();
  expect(posted).toEqual([
    "🔴 testnet · No market maker connected\nhttp://web/health: nobody gets a quote. Check the mm service",
    "🔴 testnet · Relay down\nhttp://web/health: Error: HTTP 502",
    "✅ testnet · Resolved: Relay down\nLasted 0 min",
    "✅ testnet · Resolved: No market maker connected\nLasted 0 min",
  ]);
});

it("alerts a connected market maker that prices nothing, holds it through an outage, a disconnect and a bad /marks read, and resolves it once marks come back", async () => {
  const empty = async () => Response.json([]);
  const priced = async () => Response.json([{ series_id: "x" }]);
  const down = async () => new Response("", { status: 502 });
  const { posted, run } = stack(
    [healthy(1), healthy(1), down, down, healthy(0), healthy(0), healthy(1), healthy(1), healthy(1)],
    [empty, empty, priced, priced, priced, priced, async () => new Response("", { status: 500 }), priced, priced],
  );
  await run();
  expect(posted).toEqual([
    "🔴 testnet · Market maker prices nothing\nhttp://web/marks: a market maker is connected but prices nothing. Check the lister's log, Deribit, and the MM's USDC and NEAR",
    "🔴 testnet · Relay down\nhttp://web/health: Error: HTTP 502",
    "✅ testnet · Resolved: Relay down\nLasted 0 min",
    "🔴 testnet · No market maker connected\nhttp://web/health: nobody gets a quote. Check the mm service",
    "✅ testnet · Resolved: No market maker connected\nLasted 0 min",
    "✅ testnet · Resolved: Market maker prices nothing\nLasted 0 min",
  ]);
});

it("stays quiet through a deploy: one check with the relay restarting and one with the market maker not back yet", async () => {
  const { posted, run } = stack([healthy(1), async () => new Response("", { status: 502 }), healthy(0), healthy(1), healthy(1)]);
  await run();
  expect(posted).toEqual([]);
});

it("alerts the stack down when /health hangs past the 5 s timeout", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  chain.series.mockResolvedValue([]);
  chain.nearBalance.mockResolvedValue({ amount: 10n * NEAR, storageUsage: 0 });
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 0);
    return controller.signal;
  });
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))));
  await ticks(2, { ...CONFIG, healthUrl: HEALTH_URL, webhookUrl: undefined });
  expect(timeout).toHaveBeenCalledWith(5_000);
  expect(log).toHaveBeenCalledWith("ALERT [testnet] Relay down: http://web/health: TimeoutError: The operation was aborted due to timeout");
});
