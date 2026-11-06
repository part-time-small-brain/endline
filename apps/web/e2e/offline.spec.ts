import { listedWidth, type Mark, seriesId, toSign, type QuoteRequest, type StatusUpdate } from "@endline/sdk";
import type { Page, Route } from "@playwright/test";
import { expect, handleOf, money, term, test } from "./fixtures.ts";

const USD = 1_000_000;
const NOW_MS = Date.parse(process.env.E2E_NOW ?? "2026-11-04T12:00:00Z");
const listed = [5, 6].flatMap((day) =>
  [78_000, 79_000, 80_000, 81_000, 82_000, 83_000].flatMap((strike) =>
    (["call", "put"] as const).map((kind) => ({
      id: `BTC-${day}NOV26-${strike}_${kind === "call" ? strike + 2_000 : strike - 2_000}-${kind === "call" ? "C" : "P"}`,
      underlying: "BTC",
      kind,
      strike: String(strike * USD),
      width: String(2_000 * USD),
      expiry: Date.UTC(2026, 10, day, 8) / 1000,
      underlying_decimals: 8,
      option_asset: "nep245:opt.demo.testnet:x",
      quotable: true,
    })),
  ),
);
const view: Record<string, unknown> = {
  get_config: { intents_id: "intents.demo.testnet", quote_asset: "nep141:usdc.demo.testnet", quote_decimals: 6, timing: { write_cutoff_sec: 1_800 } },
  get_underlyings: [["BTC", { decimals: 8 }]],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
});

async function live(page: Page, marks: () => unknown[] | undefined | "hang", index = () => 80_650, series = listed) {
  await page.route("**/rpc", (route) => {
    const value = view[route.request().postDataJSON().params.method_name];
    route.fulfill({ json: { jsonrpc: "2.0", id: "web", ...(value === undefined ? { error: { message: "unknown" } } : { result: { result: [...Buffer.from(JSON.stringify(value))] } }) } });
  });
  await page.route("**/series", (route) => route.fulfill({ json: { quote_asset: "nep141:usdc.demo.testnet", quote_decimals: 6, series } }));
  await page.route("**/marks", (route) => {
    const answer = marks();
    if (answer !== "hang") route.fulfill({ json: answer ?? { error: "no market makers" } });
  });
  await page.route("https://www.deribit.com/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("chart")
        ? { result: Array.from({ length: 48 }, (_, i) => [NOW_MS - (48 - i) * 1_800_000, 80_000 + i * 10]) }
        : { result: { index_price: index() } },
    }),
  );
  await page.goto("/app");
}

async function quoteFlow(page: Page, open = true) {
  const state = {
    quotes: 0,
    premium: 25,
    hangPublish: false,
    signed: [] as string[],
    published: [] as string[],
    checked: [] as string[],
    balanceReads: 0,
    quote: async (route: Route, json: unknown) => { await route.fulfill({ json }); },
    status: (): StatusUpdate["status"] | number | "hang" => "settled",
  };
  await page.exposeFunction("tradeSigned", (message: string) => state.signed.push(message));
  await page.addInitScript(() => {
    const w = window as unknown as {
      ethereum: object;
      tradeSigned(message: string): Promise<void>;
      releaseTrade?: () => void;
      holdTrade?: boolean;
      losePublish?: boolean;
      publishHttpError?: number;
    };
    w.ethereum = {
      async request({ method, params }: { method: string; params: string[] }) {
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method !== "personal_sign") throw new Error(method);
        const message = new TextDecoder().decode(Uint8Array.from((params[0]!.slice(2).match(/../g) ?? []), (byte) => parseInt(byte, 16)));
        if (message.includes("token_diff")) {
          await w.tradeSigned(message);
          if (w.holdTrade) await new Promise<void>((resolve) => { w.releaseTrade = resolve; });
        }
        return `0x${"11".repeat(64)}1b`;
      },
    };
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const url = String(args[0]);
      if (url.endsWith("/publish")) {
        if (w.losePublish) throw new TypeError("Failed to fetch");
        if (w.publishHttpError) return new Response(JSON.stringify({ error: "quote is already settled" }), { status: w.publishHttpError });
      }
      if (url.includes("/status/")) return new Response(await response.text(), { status: Number(response.headers.get("x-status") ?? 200) });
      return response;
    };
  });
  await page.route("**/fills/*", (route) => route.fulfill({ json: [] }));
  await page.route("**/quote", async (route) => {
    const request = route.request().postDataJSON() as QuoteRequest;
    const signBy = await page.evaluate(() => Date.now() + 20_000);
    const quoteId = `quote-${++state.quotes}`;
    const premium = String(state.premium * USD);
    const cash = { asset: "nep141:usdc.demo.testnet", amount: premium };
    const option = { asset: `nep245:opt.demo.testnet:${request.series_id}`, amount: request.size };
    const [pay, receive] = request.side === "buy" ? [cash, option] : [option, cash];
    await state.quote(route, {
      quote_id: quoteId, series_id: request.series_id, side: request.side, size: request.size,
      premium, pay, receive, sign_by_ms: signBy,
      payload: toSign(request.signer.standard, {
        signer_id: request.signer.signer_id, verifying_contract: "intents.demo.testnet", deadline: new Date(signBy + 3_000).toISOString(), nonce: "AA==",
        intents: [{ intent: "token_diff", diff: { [pay.asset]: `-${pay.amount}`, [receive.asset]: receive.amount } }],
      }),
    });
  });
  await page.route("**/publish", async (route) => {
    const id = route.request().postDataJSON().quote_id as string;
    state.published.push(id);
    if (state.hangPublish) return;
    await route.fulfill({ json: { quote_id: id, status: "settling" } });
  });
  await page.route("**/status/*", async (route) => {
    const id = route.request().url().split("/").at(-1)!;
    state.checked.push(id);
    const status = state.status();
    if (status === "hang") return;
    await route.fulfill(typeof status === "number"
      ? { headers: { "x-status": String(status) }, json: { error: "status unavailable" } }
      : { json: { quote_id: id, status, tx_hash: status === "settled" ? "original-fill" : undefined } });
  });
  await live(page, () => [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), bid: String(380 * USD), vol: 0.4 }]);
  await page.route("**/rpc", async (route) => {
    const params = route.request().postDataJSON().params;
    const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
    const value = params.method_name === "current_salt" ? "00000000"
      : params.method_name === "mt_batch_balance_of" ? (state.balanceReads++, args.token_ids.map(() => String(250 * USD)))
      : view[params.method_name];
    await route.fulfill({ json: { jsonrpc: "2.0", id: "web", result: { result: [...Buffer.from(JSON.stringify(value))] } } });
  });
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: /Ethereum wallet/ }).click();
  await page.evaluate(() => {
    history.replaceState(null, "", "/");
    history.pushState(null, "", "/app");
  });
  if (open) {
    await page.getByRole("button", { name: "Buy Up · $25" }).click();
    await expect(page.getByRole("button", { name: "Buy for $25" })).toBeVisible();
  }
  return state;
}

for (const phase of ["loading", "refreshing"] as const) {
  test(`a delayed ${phase} quote cannot be abandoned or duplicated across SPA navigation`, async ({ page }) => {
    const state = await quoteFlow(page, phase === "refreshing");
    let release!: () => void;
    state.quote = async (route, json) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fulfill({ json });
    };
    if (phase === "loading") await page.getByRole("button", { name: "Buy Up · $25" }).click();
    else await page.clock.fastForward(15_000);
    const count = phase === "loading" ? 1 : 2;
    await expect.poll(() => state.quotes).toBe(count);
    const dialog = page.getByRole("dialog", { name: "Confirm" });
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click({ force: true });
    await page.mouse.click(5, 5);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(dialog).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(dialog).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/app$/);
    await expect(dialog).toBeVisible();
    expect(state.quotes).toBe(count);
    release();
    await page.evaluate(() => { (window as unknown as { holdTrade: boolean }).holdTrade = true; });
    await page.getByRole("button", { name: "Buy for $25" }).click();
    await expect.poll(() => state.signed.length).toBe(1);
    await page.goBack();
    await expect(dialog).toBeVisible();
    await page.clock.fastForward(2_000);
    expect(state.quotes).toBe(count);
    await page.evaluate(() => { (window as unknown as { releaseTrade: () => void }).releaseTrade(); });
    await page.clock.runFor(1_100);
    await expect(page.getByText("You're in")).toBeVisible();
    expect(state.quotes).toBe(count);
    expect(state.published).toEqual([`quote-${count}`]);
  });
}

for (const side of ["buy", "sell"] as const) {
  test(`an unknown ${side} retains its modal and quote through keyboard cycles and Back to trade and landing`, async ({ page }) => {
    const state = await quoteFlow(page, false);
    await page.getByRole("link", { name: /Positions/ }).click();
    if (side === "buy") {
      await page.getByRole("link", { name: "Trade", exact: true }).click();
      await page.getByRole("button", { name: "Buy Up · $25" }).click();
    } else await page.getByRole("button", { name: "Sell back", exact: true }).first().click();
    state.status = () => "settling";
    await page.getByRole("button", { name: `${side === "buy" ? "Buy" : "Sell back"} for $25` }).click();
    await expect.poll(() => state.published.length).toBe(1);
    await page.clock.runFor(1_100);
    await page.clock.fastForward(60_000);
    const dialog = page.getByRole("dialog", { name: side === "buy" ? "Confirm" : "Sell back", exact: true });
    const check = dialog.getByRole("button", { name: "Check status", exact: true });
    await expect(check).toBeVisible();
    await dialog.evaluate((element) => { element.setAttribute("data-original", "yes"); });
    if (side === "buy") await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(dialog).toHaveAttribute("data-original", "yes");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(dialog).toHaveAttribute("data-original", "yes");
    await check.focus();
    for (const key of ["Tab", "Shift+Tab", "Tab", "Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      await expect(check).toBeFocused();
    }
    expect(state.quotes).toBe(1);
    state.status = () => "settled";
    await check.click();
    await expect(page.getByText(side === "buy" ? "You're in" : "Sold", { exact: true })).toBeVisible();
    expect(new Set(state.checked)).toEqual(new Set(["quote-1"]));
    expect(state.published).toEqual(["quote-1"]);
  });
}

test("the NEAR provider popup owns focus without dismissing the underlying sheet", async ({ page }) => {
  await live(page, () => []);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Connect", exact: true });
  await page.evaluate(() => {
    const popup = document.createElement("div");
    popup.className = "hot-connector-popup";
    popup.innerHTML = '<button type="button">Wallet settings</button><textarea aria-label="Wallet manifest"></textarea>';
    document.body.append(popup);
    popup.querySelector("textarea")?.focus();
  });
  const manifest = page.getByRole("textbox", { name: "Wallet manifest" });
  await expect(manifest).toBeFocused();
  await page.keyboard.type("manifest");
  await expect(manifest).toHaveValue("manifest");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Wallet settings" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(manifest).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await page.evaluate(() => document.querySelector(".hot-connector-popup")?.remove());
  await page.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("quote renewal blocks the old price, requires acceptance and never races a delayed wallet", async ({ page }) => {
  const state = await quoteFlow(page);
  const original = state.quotes;
  state.premium = 26;
  let release!: () => void;
  state.quote = async (route, json) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json });
  };
  await page.clock.fastForward(15_000);
  await expect.poll(() => state.quotes).toBe(original + 1);
  await expect(page.getByRole("button", { name: "Refreshing price…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Buy for/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Refreshing price…" }).click({ force: true });
  expect(state.signed).toEqual([]);
  release();
  await expect(page.getByRole("button", { name: "Accept new price" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy for/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Accept new price" }).click();
  await page.evaluate(() => { (window as unknown as { holdTrade: boolean }).holdTrade = true; });
  await page.getByRole("button", { name: "Buy for $26" }).click();
  await expect.poll(() => state.signed.length).toBe(1);
  await page.clock.fastForward(15_000);
  expect(state.quotes).toBe(original + 1);
  await page.evaluate(() => { (window as unknown as { releaseTrade: () => void }).releaseTrade(); });
  await page.clock.runFor(1_100);
  await expect(page.getByText("You're in")).toBeVisible();
  expect(state.published).toEqual([`quote-${original + 1}`]);
});

test("signing just before renewal blocks background quote requests until the wallet finishes", async ({ page }) => {
  const state = await quoteFlow(page);
  const original = state.quotes;
  await page.evaluate(() => { (window as unknown as { holdTrade: boolean }).holdTrade = true; });
  await page.clock.fastForward(14_000);
  await page.getByRole("button", { name: "Buy for $25" }).click();
  await expect.poll(() => state.signed.length).toBe(1);
  await page.clock.fastForward(2_000);
  expect(state.quotes).toBe(original);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as unknown as { releaseTrade: () => void }).releaseTrade(); });
  await page.clock.runFor(1_100);
  await expect(page.getByText("You're in")).toBeVisible();
  expect(state.published).toEqual([`quote-${original}`]);
});

test("a failed quote renewal never restores the old signable price", async ({ page }) => {
  const state = await quoteFlow(page);
  state.quote = async (route) => { await route.fulfill({ json: { error: "refresh failed" } }); };
  await page.clock.fastForward(15_000);
  await expect(page.getByText("No price right now", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Buy for/ })).toHaveCount(0);
  expect(state.signed).toEqual([]);
});

for (const error of ["transport", 409] as const) {
  test(`a publish ${error} error reconciles the original fill and reloads balances`, async ({ page }) => {
    const state = await quoteFlow(page);
    await page.evaluate((error) => {
      const w = window as unknown as { losePublish: boolean; publishHttpError: number };
      if (error === "transport") w.losePublish = true;
      else w.publishHttpError = error;
    }, error);
    const reads = state.balanceReads;
    const id = `quote-${state.quotes}`;
    await page.getByRole("button", { name: "Buy for $25" }).click();
    await page.clock.runFor(1_100);
    await expect(page.getByText("You're in")).toBeVisible();
    await expect(page.getByRole("button", { name: /auto-collect/i })).toBeVisible();
    await expect.poll(() => state.balanceReads).toBeGreaterThan(reads);
    expect(state.published).toEqual([id]);
    expect(state.checked).toEqual([id]);
  });
}

test("status polling retries temporary errors including HTTP errors on the same quote", async ({ page }) => {
  const state = await quoteFlow(page);
  const id = `quote-${state.quotes}`;
  const replies = [503, 404, "settling", "settled"] as const;
  state.status = () => replies[Math.min(state.checked.length - 1, replies.length - 1)]!;
  await page.getByRole("button", { name: "Buy for $25" }).click();
  for (let i = 1; i <= replies.length; i++) {
    await page.clock.runFor(1_100);
    await expect.poll(() => state.checked.length).toBe(i);
  }
  await expect(page.getByText("You're in")).toBeVisible();
  expect(state.checked).toEqual(replies.map(() => id));
});

for (const status of ["settling", 404, "hang"] as const) {
  test(`unresolved settlement (${status}) checks only the original quote, never a fresh buy`, async ({ page }) => {
    const state = await quoteFlow(page);
    const original = state.quotes;
    const id = `quote-${original}`;
    state.status = () => status;
    await page.getByRole("button", { name: "Buy for $25" }).click();
    await expect.poll(() => state.published.length).toBe(1);
    await page.clock.runFor(1_100);
    await expect.poll(() => state.checked.length).toBe(1);
    await page.clock.fastForward(60_000);
    await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeVisible();
    await expect(page.getByText(/nothing was charged/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Get new price" })).toHaveCount(0);
    const close = page.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeDisabled();
    await close.click({ force: true });
    await page.mouse.click(5, 5);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Confirm" })).toBeVisible();
    expect(state.quotes).toBe(original);
    state.status = () => "settled";
    await page.getByRole("button", { name: "Check status", exact: true }).click();
    await expect(page.getByText("You're in")).toBeVisible();
    expect(new Set(state.checked)).toEqual(new Set([id]));
    expect(state.published).toEqual([id]);
  });
}

test("a hanging publish becomes unknown without resubmitting or claiming no charge", async ({ page }) => {
  const state = await quoteFlow(page);
  const id = `quote-${state.quotes}`;
  state.hangPublish = true;
  await page.getByRole("button", { name: "Buy for $25" }).click();
  await expect.poll(() => state.published.length).toBe(1);
  await page.clock.fastForward(60_000);
  await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeVisible();
  await expect(page.getByText(/nothing was charged/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Get new price" })).toHaveCount(0);
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await expect(page.getByText("You're in")).toBeVisible();
  expect(state.published).toEqual([id]);
  expect(state.checked).toEqual([id]);
});

for (const status of ["failed", "expired"] as const) {
  test(`only known ${status} status offers no-fill and a new price`, async ({ page }) => {
    const state = await quoteFlow(page);
    state.status = () => status;
    await page.getByRole("button", { name: "Buy for $25" }).click();
    await page.clock.runFor(1_100);
    await expect(page.getByText("Not filled, nothing was charged", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get new price" })).toBeVisible();
  });
}

test("with no relay the hero waits for live prices and never links a series", async ({ page }) => {
  await page.route("**/rpc", (route) => route.fulfill({ json: { jsonrpc: "2.0", id: "web", error: { message: "offline" } } }));
  await page.goto("/");
  await page.clock.fastForward(10_000);
  const hero = page.locator("#top");
  await expect(hero.getByLabel("Loading prices")).toBeVisible();
  await expect(hero.getByRole("link", { name: /^Try / })).toHaveCount(0);
  await expect(page.locator('a[href*="series="]')).toHaveCount(0);
});

test("without marks from a market maker nothing is offered", async ({ page }) => {
  await live(page, () => []);
  await expect(page.getByText("No prices right now")).toBeVisible();
  await expect(handleOf(page)).toHaveCount(0);
  await expect(term(page, "Max loss")).toHaveCount(0);
});

test("offers only marked strikes, sizes at the mark's ask and takes the chance from its vol", async ({ page }) => {
  let vol = 0.2;
  const mark = (strike: number) => ({ series_id: `BTC-5NOV26-${strike}_${strike + 2_000}-C`, ask: String(400 * USD), bid: String(380 * USD), vol });
  await live(page, () => [mark(81_000), mark(82_000)]);
  const handle = handleOf(page);
  await expect(handle).toHaveAttribute("aria-valuemin", "81000");
  await expect(handle).toHaveAttribute("aria-valuemax", "82000");
  await expect(handle).toHaveAttribute("aria-valuenow", "81000");
  await expect.poll(() => money(term(page, "Max loss"))).toBe(25);
  await expect.poll(() => money(term(page, /^If BTC ends above /))).toBe(125);
  const up = page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: /^Up/ });
  await expect(up).toContainText("32%");
  vol = 0.8;
  await page.clock.fastForward(5_000);
  await expect(up).toContainText("45%");
  await page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: /^Down/ }).click();
  await expect(page.getByText("No prices right now")).toBeVisible();
});

test("offers only dates with prices it can sell at and opens on the first of them", async ({ page }) => {
  await live(page, () => [
    { series_id: "BTC-5NOV26-81000_83000-C", ask: String(2_000 * USD), vol: 0.4 },
    { series_id: "BTC-6NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 },
  ]);
  await expect(handleOf(page)).toHaveAttribute("aria-valuenow", "81000");
  await expect(page.getByRole("radiogroup", { name: "Ends" }).getByRole("radio")).toHaveCount(1);
});

test("stops showing the last prices once the relay's marks hang", async ({ page }) => {
  let hang = false;
  await live(page, () => (hang ? "hang" : [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 }]));
  await expect(handleOf(page)).toBeVisible();
  hang = true;
  await page.clock.fastForward(5_000);
  await expect(page.getByText("No prices right now")).toBeVisible({ timeout: 10_000 });
});

test("Lite hides stale payouts and offers no unpriced dates or prices", async ({ page }) => {
  let priced = true;
  await live(page, () => priced ? [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), bid: String(380 * USD), vol: 0.4 }] : []);
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await expect(page.getByLabel("Maximum payout")).toHaveText("$125");
  await expect(page.getByText("Full payout if BTC ends above $83,000", { exact: true })).toBeVisible();
  priced = false;
  await page.clock.fastForward(5_000);
  await expect(page.getByRole("status").filter({ hasText: "No prices right now" })).toBeVisible();
  await expect(page.getByLabel("Maximum payout")).toHaveText("—");
  await expect(page.getByText(/^Full payout if/)).toHaveCount(0);
  await page.getByRole("button", { name: "End date", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "End date options" }).getByRole("radio")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Price to beat", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Prices to beat" }).getByRole("radio")).toHaveCount(0);
});

test("Lite still shows exact gross payout when rounding leaves no profit", async ({ page }) => {
  await live(page, () => [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(2_000 * USD - 1), vol: 0.2 }]);
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await expect(page.getByLabel("Maximum payout")).toHaveText("$25");
  await expect(page.getByLabel("Trade ticket").getByText("1.0×", { exact: true })).toBeVisible();
  await expect(page.getByText("Max loss $25", { exact: false })).toBeVisible();
  await expect(page.getByText("Full payout if BTC ends above $83,000", { exact: true })).toBeVisible();
});

test("Lite date chances match the nearest marked price it selects", async ({ page }) => {
  await live(page, () => [
    { series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.2 },
    { series_id: "BTC-5NOV26-82000_84000-C", ask: String(2_000 * USD), vol: 0.2 },
    { series_id: "BTC-6NOV26-82000_84000-C", ask: String(500 * USD), vol: 0.8 },
    { series_id: "BTC-6NOV26-83000_85000-C", ask: String(100 * USD), vol: 0.8 },
  ]);
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await expect(page.getByLabel("Maximum payout")).toHaveText("$125");
  await page.getByRole("button", { name: "End date", exact: true }).click();
  const dates = page.getByRole("radiogroup", { name: "End date options" }).getByRole("radio");
  await expect(dates).toHaveCount(2);
  const row = dates.last();
  const chance = /[<>]?\d+%/.exec(await row.innerText())?.[0];
  expect(chance).toBeTruthy();
  await row.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Price to beat", exact: true })).toContainText("$82,000");
  await expect(page.getByRole("button", { name: "About estimated chance" })).toHaveAccessibleDescription(`${chance} estimated chance`);
  await expect(page.getByLabel("Maximum payout")).toHaveText("$100");
  await expect(page.getByText("Full payout if BTC ends above $84,000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Price to beat", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Prices to beat" }).getByRole("radio")).toHaveCount(2);
});

test("stops showing the last prices once the relay's marks fail", async ({ page }) => {
  let up = true;
  await live(page, () => (up ? [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 }] : undefined));
  await expect(handleOf(page)).toBeVisible();
  up = false;
  await page.clock.fastForward(5_000);
  await expect(page.getByText("No prices right now")).toBeVisible();
  await expect(handleOf(page)).toHaveCount(0);
});

test.describe("Tap", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("trade-mode", "tap"));
  });

  test("offers exactly the marked series on their own side of spot, at the gross multiple of the mark", async ({ page }) => {
    await live(page, () => [
      { series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 },
      { series_id: "BTC-5NOV26-80000_78000-P", ask: String(400 * USD), vol: 0.4 },
      { series_id: "BTC-6NOV26-82000_84000-C", ask: String(500 * USD), vol: 0.4 },
      { series_id: "BTC-6NOV26-81000_79000-P", ask: String(400 * USD), vol: 0.4 },
    ]);
    const grid = page.getByRole("table");
    await expect(grid.getByRole("rowheader")).toHaveText([/^\$82,000/, /^\$81,000/, /^\$80,000/]);
    const names = await grid.getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));
    expect(names).toEqual([
      expect.stringMatching(/^Up · BTC ends above \$82,000 · .* · pays up to 4\.0×$/),
      expect.stringMatching(/^Up · BTC ends above \$81,000 · .* · pays up to 5\.0×$/),
      expect.stringMatching(/^Down · BTC ends below \$80,000 · .* · pays up to 5\.0×$/),
    ]);
  });

  test("a press that spans a cell turning from Up to Down buys nothing", async ({ page }) => {
    let index = 80_650;
    await live(
      page,
      () => [
        { series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 },
        { series_id: "BTC-5NOV26-81000_79000-P", ask: String(400 * USD), vol: 0.4 },
      ],
      () => index,
    );
    const box = (await page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000/ }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    index = 81_200;
    await page.clock.fastForward(5_000);
    const down = page.getByRole("table").getByRole("button", { name: /^Down · BTC ends below \$81,000/ });
    await expect(down).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await down.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  async function withTapBalance(page: Page) {
    const state = await quoteFlow(page, false);
    await page.route("**/claims", (route) => route.fulfill({ json: {} }));
    await page.getByRole("button", { name: "Set up", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Tap balance" });
    await sheet.getByRole("button", { name: "Set up with your wallet" }).click();
    await sheet.getByRole("button", { name: "Sign once more to check" }).click();
    await expect(sheet.getByText("In your Tap balance")).toBeVisible();
    await page.keyboard.press("Escape");
    return state;
  }

  test("a tap signs only while the firm quote still pays the multiple on the cell, and a refused one shows the new multiple at once", async ({ page }) => {
    const state = await withTapBalance(page);
    await page.route("**/rpc", async (route) => {
      const params = route.request().postDataJSON().params;
      if (params.method_name !== "mt_batch_balance_of") return route.fallback();
      const ids: string[] = JSON.parse(Buffer.from(params.args_base64, "base64").toString()).token_ids;
      await route.fulfill({ json: { jsonrpc: "2.0", id: "web", result: { result: [...Buffer.from(JSON.stringify(ids.map((id) => (id.endsWith("-P") ? "0" : String(250 * USD)))))] } } });
    });
    await page.clock.fastForward(10_000);
    let ask = 400;
    await page.route("**/marks", (route) => route.fulfill({ json: [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(ask * USD), bid: String(380 * USD), vol: 0.4 }] }));
    const cell = page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow/ });
    await expect(cell).toHaveAccessibleName(/· pays up to 5\.0×/);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    ask = 416;
    state.premium = 26;
    await cell.click();
    await expect(page.getByRole("status").filter({ hasText: "The price moved. Tap again for the new one." })).toBeVisible();
    await expect(cell).toHaveAccessibleName(/· pays up to 4\.8×/);
    expect(state.published).toEqual([]);
    await page.clock.resume();
    await page.route("https://www.deribit.com/**", (route) => (route.request().url().includes("chart") ? route.fallback() : route.fulfill({ json: { result: { index_price: 81_200 } } })));
    await page.clock.fastForward(5_000);
    await expect(cell).toHaveAccessibleName(/· winning now · you hold this$/);
    state.premium = 25;
    await cell.click();
    await expect(page.getByRole("status").filter({ hasText: "Bought BTC Up $81,000 for $25.00." })).toBeVisible();
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
    await expect.poll(() => cell.evaluate((el) => el.getAnimations().filter((a) => a instanceof CSSTransition).length)).toBe(0);
    await expect(cell).toHaveCSS("background-color", "rgb(11, 38, 28)");
    expect(state.published).toEqual(["quote-2"]);
  });

  test("a move the relay can't confirm never says nothing moved, and rereads both balances", async ({ page }) => {
    const state = await withTapBalance(page);
    await page.route("**/health", (route) => route.fulfill({ json: { ok: true, market_makers: 1, relayer_id: "relayer.demo.testnet" } }));
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => (String(input).endsWith("/transfer") ? Promise.resolve(new Response("error code: 524", { status: 524 })) : fetch(input, init));
    });
    await page.getByRole("button", { name: "Top up or move" }).click();
    const sheet = page.getByRole("dialog", { name: "Tap balance" });
    const reads = state.balanceReads;
    await sheet.getByRole("button", { name: "Move $25 in" }).click();
    await expect(sheet.getByRole("alert")).toHaveText("We couldn't confirm this move. Check both balances before you try again.");
    await expect.poll(() => state.balanceReads).toBeGreaterThan(reads);
  });

  test("Your taps never offers a bet without a price for $0, nor one the relay won't quote", async ({ page }) => {
    await withTapBalance(page);
    const mine = page.getByRole("region", { name: "Your taps" });
    await expect(mine.getByRole("button", { name: /^Sell \$/ })).toHaveText([/^Sell \$[\d,.]+$/]);
    await expect(mine.getByRole("button", { name: "Sell unavailable" }).first()).toBeDisabled();
    const closed = listed.map((s) => (s.id === "BTC-5NOV26-81000_83000-C" ? { ...s, quotable: false } : s));
    await page.route("**/series", (route) => route.fulfill({ json: { quote_asset: "nep141:usdc.demo.testnet", quote_decimals: 6, series: closed } }));
    await page.clock.fastForward(15_000);
    await expect(mine.getByRole("button", { name: /^Sell \$/ })).toHaveCount(0);
  });

  test("a held cell shows what it's worth and its P&L, and glows and flashes each time spot crosses its price to beat", async ({ page }) => {
    let index = 80_650;
    let marks: Mark[] = [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), bid: String(380 * USD), vol: 0.4 }];
    const token = "nep245:opt.demo.testnet:BTC-5NOV26-81000_83000-C";
    await page.addInitScript(() => {
      (window as unknown as { ethereum: object }).ethereum = {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
          throw new Error(method);
        },
      };
    });
    await page.route("**/fills/*", (route) =>
      route.fulfill({ json: [{ quote_id: "q", series_id: "BTC-5NOV26-81000_83000-C", side: "buy", account_id: "0x1111111111111111111111111111111111111111", size: "2000000", premium: String(5 * USD), tx_hash: "tx", at_ms: NOW_MS - 3_600_000 }] }),
    );
    await live(page, () => marks, () => index);
    await page.route("**/rpc", (route) => {
      const params = route.request().postDataJSON().params;
      const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
      const value = params.method_name === "mt_batch_balance_of" ? args.token_ids.map((id: string) => (id === token ? "2000000" : "0")) : view[params.method_name];
      route.fulfill({ json: { jsonrpc: "2.0", id: "web", ...(value === undefined ? { error: { message: "unknown" } } : { result: { result: [...Buffer.from(JSON.stringify(value))] } }) } });
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: /Ethereum wallet/ }).click();
    const cell = page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow/ });
    const flashes = () => cell.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => (a as CSSAnimation).animationName === "fade").length);
    await expect(cell).toHaveAccessibleName(/· pays up to 5\.0× · worth \$7\.60 · up \$2\.60 · you hold this$/);
    await expect(cell).toHaveText("$7.60+52%5.0×");
    expect(await flashes()).toBe(0);
    index = 81_200;
    await page.clock.fastForward(5_000);
    await expect.poll(flashes, { intervals: [50] }).toBe(1);
    await expect(cell).toHaveAccessibleName(/· up \$2\.60 · winning now · you hold this$/);
    await expect.poll(flashes).toBe(0);
    index = 80_650;
    await page.clock.fastForward(5_000);
    await expect.poll(flashes, { intervals: [50] }).toBe(1);
    await expect(cell).toHaveAccessibleName(/· up \$2\.60 · you hold this$/);
    marks = [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 }];
    await page.clock.fastForward(5_000);
    await expect(cell).toHaveText("$0.00-100%5.0×");
    await expect(cell.getByText("-100%")).toHaveCSS("font-size", "16px");
    marks = [];
    await page.clock.fastForward(5_000);
    const unpriced = page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow .* · no price right now · you hold this$/ });
    await expect(unpriced).toBeDisabled();
    await expect(unpriced).toHaveCSS("opacity", "1");
  });

  async function heldThroughTheEnd(page: Page, { bothSides = false } = {}) {
    const expiry = Date.UTC(2026, 10, 5, 8) / 1000;
    const tokens = ["nep245:opt.demo.testnet:BTC-5NOV26-81000_83000-C", ...(bothSides ? ["nep245:opt.demo.testnet:BTC-5NOV26-81000_79000-P"] : [])];
    const world = { index: 81_500, settlement: null as null | { price: string; final_at: number } };
    await page.addInitScript(() => {
      (window as unknown as { ethereum: object }).ethereum = {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
          throw new Error(method);
        },
      };
    });
    await page.route("**/fills/*", (route) =>
      route.fulfill({ json: [{ quote_id: "q", series_id: "BTC-5NOV26-81000_83000-C", side: "buy", account_id: "0x1111111111111111111111111111111111111111", size: "2000000", premium: String(5 * USD), tx_hash: "tx", at_ms: NOW_MS - 3_600_000 }] }),
    );
    await live(
      page,
      () => [
        { series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), bid: String(380 * USD), vol: 0.4 },
        { series_id: "BTC-6NOV26-82000_84000-C", ask: String(400 * USD), vol: 0.4 },
      ],
      () => world.index,
    );
    const junkStrike = 500_000n * BigInt(USD);
    const junkWidth = listedWidth(junkStrike, 6);
    const junk = { ...listed[0]!, id: seriesId({ underlying: "BTC", expiry, strike: junkStrike, width: junkWidth, quoteDecimals: 6, kind: "call" }), strike: String(junkStrike), width: String(junkWidth), kind: "call" as const };
    await page.route("**/series", (route) => route.fulfill({ json: { quote_asset: "nep141:usdc.demo.testnet", quote_decimals: 6, series: [...listed, junk] } }));
    await page.route("https://www.deribit.com/**", (route) =>
      route.fulfill({
        json: route.request().url().includes("chart")
          ? { result: Array.from({ length: 1_500 }, (_, i) => [(expiry - 1_440 * 60 + (i + 1) * 60) * 1000, world.index]) }
          : { result: { index_price: world.index } },
      }),
    );
    await page.route("**/rpc", (route) => {
      const params = route.request().postDataJSON().params;
      const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
      const value = params.method_name === "mt_batch_balance_of" ? args.token_ids.map((id: string) => (tokens.includes(id) ? "2000000" : "0")) : params.method_name === "get_settlement" ? world.settlement : view[params.method_name];
      route.fulfill({ json: { jsonrpc: "2.0", id: "web", ...(value === undefined ? { error: { message: "unknown" } } : { result: { result: [...Buffer.from(JSON.stringify(value))] } }) } });
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: /Ethereum wallet/ }).click();
    await expect(page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow .* · you hold this$/ })).toBeVisible();
    const until = async (sec: number) => page.clock.fastForward(sec * 1000 - (await page.evaluate(() => Date.now())));
    return { expiry, world, until };
  }

  test("a held bet keeps its column through the final round, then shows the estimate, the proposed price, the result and a card to share", async ({ page }) => {
    await page.addInitScript(() => Object.assign(navigator, { canShare: undefined }));
    const { expiry, world, until } = await heldThroughTheEnd(page, { bothSides: true });
    const group = (name: RegExp) => page.getByRole("table").getByRole("group", { name });
    await until(expiry - 29 * 60);
    await expect(group(/^Up · BTC ends above \$81,000 · final round · on track to pay about \$10\.00 · you hold this$/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^Final round/ })).toBeVisible();
    await expect(page.getByRole("table").getByRole("rowheader")).toHaveText([/^\$82,000/, /^\$81,000/]);
    await expect(page.getByText("Final round · average so far ≈ $81,500. Estimate from Deribit's index; the final price is the median of 7 exchanges.")).toBeVisible();
    await expect(page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · / })).toHaveCount(0);
    await until(expiry + 60);
    await expect(group(/· ended · looks like it pays about \$10\.00 · you hold this$/)).toBeVisible();
    world.settlement = { price: String(81_400 * USD), final_at: expiry + 3_900 };
    await page.clock.fastForward(15_000);
    await expect(group(/· ended · pays \$8\.00 if the proposed price stands · you hold this$/)).toBeVisible();
    await expect(page.getByText(/^Proposed final price \$81,400, final at /)).toBeVisible();
    await until(expiry + 3_900);
    await expect(group(/^Up · BTC ends above \$81,000 · result · pays \$8\.00 · you hold this$/)).toBeVisible();
    await expect(page.getByText("Final price $81,400. You get $8.00 back.")).toBeVisible();
    world.index = 80_000;
    await page.clock.fastForward(5_000);
    await expect(page.getByRole("radio", { name: /^BTC \$80,000/ })).toBeVisible();
    await expect(group(/^Up · BTC ends above \$81,000 · result · pays \$8\.00 · you hold this$/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Share" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("endline-win.png");
    const bytes = await (await import("node:fs/promises")).readFile(await file.path());
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await until(expiry + 3 * 3_600);
    await expect(page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$82,000 · / })).toBeVisible();
    await expect(page.getByRole("table").getByRole("group")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: /^(Final round|Ended|Result)/ })).toHaveCount(0);
  });

  test("a share uses the phone's share sheet with the card as a PNG when it can take files", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shared: { type: string; name: string; text: string }[] };
      w.shared = [];
      Object.assign(navigator, {
        canShare: (data: { files?: File[] }) => Boolean(data.files?.length),
        share: async (data: { files: File[]; text: string }) => void w.shared.push({ type: data.files[0]!.type, name: data.files[0]!.name, text: data.text }),
      });
    });
    const { expiry, world, until } = await heldThroughTheEnd(page);
    world.settlement = { price: String(81_400 * USD), final_at: expiry + 3_900 };
    await until(expiry + 3_900);
    await page.getByRole("button", { name: "Share" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([{ type: "image/png", name: "endline-win.png", text: "BTC Up $81,000: Won $8.00 on Endline" }]);
  });

  for (const [refusal, downloads] of [["NotAllowedError", 1], ["AbortError", 0]] as const) {
    test(`a share sheet that throws ${refusal} ${downloads ? "falls back to a download" : "is left alone"}`, async ({ page }) => {
      await page.addInitScript((name) => {
        const w = window as unknown as { shares: number };
        w.shares = 0;
        Object.assign(navigator, { canShare: () => true, share: async () => (w.shares++, Promise.reject(new DOMException("no", name))) });
      }, refusal);
      const { expiry, world, until } = await heldThroughTheEnd(page);
      world.settlement = { price: String(81_400 * USD), final_at: expiry + 3_900 };
      await until(expiry + 3_900);
      let downloaded = 0;
      page.on("download", () => downloaded++);
      const download = downloads ? page.waitForEvent("download") : undefined;
      await page.getByRole("button", { name: "Share" }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { shares: number }).shares)).toBe(1);
      await download;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
      expect(downloaded).toBe(downloads);
    });
  }

  test("a bet that ends short of its price to beat says so and offers nothing to share", async ({ page }) => {
    const { expiry, world, until } = await heldThroughTheEnd(page);
    world.index = 80_000;
    await until(expiry - 10 * 60);
    await expect(page.getByRole("table").getByRole("group", { name: /· final round · on track to pay nothing · you hold this$/ })).toBeVisible();
    world.settlement = { price: String(80_000 * USD), final_at: expiry + 3_900 };
    await until(expiry + 3_900);
    await expect(page.getByRole("table").getByRole("group", { name: /· result · lost · you hold this$/ })).toBeVisible();
    await expect(page.getByText("Final price $80,000.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  });

  async function freeCalls(page: Page, series = listed, calls: unknown[] = []) {
    const account = "0x1111111111111111111111111111111111111111";
    const relay = { calls, posted: [] as { series_id: string; signer: unknown }[], hold: Promise.resolve() };
    const board = {
      round: "2026-11-04",
      today: [
        { account_id: "sun.near", rank: 1, points: 1_250, wins: 4, streak: 3 },
        { account_id: "kite.near", rank: 2, points: 980, wins: 3, streak: 1 },
      ],
      week: [{ account_id: "sun.near", rank: 1, points: 3_100, wins: 9, streak: 3 }],
      you: { today: { account_id: account, rank: 7, points: 150, wins: 1, streak: 2 }, week: null },
    };
    await page.addInitScript(() => {
      localStorage.setItem("tap-free", "1");
      const w = window as unknown as { ethereum: object; signs: number; refuseCalls?: { status: number; error: string } };
      w.signs = 0;
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => (String(input).endsWith("/calls") && w.refuseCalls ? Promise.resolve(new Response(JSON.stringify({ error: w.refuseCalls.error }), { status: w.refuseCalls.status })) : fetch(input, init));
      w.ethereum = {
        async request({ method }: { method: string }) {
          if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
          if (method !== "personal_sign") throw new Error(method);
          w.signs++;
          return `0x${"11".repeat(64)}1b`;
        },
      };
    });
    await page.route("**/calls", async (route) => {
      const body = route.request().postDataJSON() as { series_id: string; signer: unknown };
      relay.posted.push(body);
      await relay.hold;
      const { id, option_asset, quotable, ...terms } = series.find((s) => s.id === body.series_id)!;
      const call = { series_id: id, account_id: account, terms, ask: String(400 * USD), at_ms: NOW_MS };
      relay.calls.unshift(call);
      await route.fulfill({ json: call });
    });
    await page.route("**/calls/*", (route) => route.fulfill({ json: relay.calls }));
    await page.route("**/leaderboard/*", (route) => route.fulfill({ json: board }));
    await page.route("**/fills/*", (route) => route.fulfill({ json: [] }));
    await live(page, () => [
      { series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 },
      { series_id: "BTC-5NOV26-82000_84000-C", ask: String(18_721), vol: 0.4 },
      { series_id: "BTC-6NOV26-82000_84000-C", ask: String(400 * USD), vol: 0.4 },
    ], undefined, series);
    await page.route("**/rpc", (route) => {
      const params = route.request().postDataJSON().params;
      const args = JSON.parse(Buffer.from(params.args_base64, "base64").toString());
      const value = params.method_name === "current_salt" ? "00000000" : params.method_name === "mt_batch_balance_of" ? args.token_ids.map(() => "0") : view[params.method_name];
      route.fulfill({ json: { jsonrpc: "2.0", id: "web", ...(value === undefined ? { error: { message: "unknown" } } : { result: { result: [...Buffer.from(JSON.stringify(value))] } }) } });
    });
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: /Ethereum wallet/ }).click();
    const signs = () => page.evaluate(() => (window as unknown as { signs: number }).signs);
    return { relay, board, signs };
  }

  test("a free call records the cell, counts down the round, refuses what the relay refuses, shows the board and keeps the sign-in across a reload", async ({ page }) => {
    const { relay, signs } = await freeCalls(page);
    const grid = page.getByRole("table");
    await expect(page.getByRole("radio", { name: /^Free call/ })).toHaveAttribute("aria-checked", "true");
    await expect(grid).toHaveAccessibleName(/^Tap a cell of the next round to call it for free\. /);
    await expect(grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow .* · pays up to 25\.0×$/ })).toBeVisible();
    await expect(grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Fri 6 / })).toBeDisabled();
    await grid.getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Called BTC Up $81,000 at 5.0×." })).toBeVisible();
    expect(relay.posted).toEqual([expect.objectContaining({ series_id: "BTC-5NOV26-81000_83000-C", signer: { standard: "erc191", signer_id: "0x1111111111111111111111111111111111111111" } })]);
    expect(await signs()).toBe(1);
    const called = grid.getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow .* · pays up to 5\.0× · you called this$/ });
    await expect(called).toHaveText("Called5.0×");
    await expect(called).toBeDisabled();
    await expect(page.getByRole("radio", { name: /^Free call/ })).toContainText("9 of 10 left this round");
    const board = page.getByRole("region", { name: "Free calls" });
    await expect(board.getByRole("list", { name: "Round 4 Nov" }).getByRole("listitem")).toHaveText([/^1\. sun\.near\s*\+1250\s*3-day streak$/, /^2\. kite\.near\s*\+980$/, /^7\. 0x1111…1111\s*\+150\s*2-day streak$/]);
    await page.evaluate(() => Object.assign(window, { refuseCalls: { status: 429, error: "you've used your 10 free calls for this round" } }));
    await grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: "You've used your 10 free calls for this round." })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: /Ethereum wallet/ }).click();
    await page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Called BTC Up \$82,000 at 5\.0×\.$/ })).toBeVisible();
    expect(await signs()).toBe(0);
    await page.getByRole("radio", { name: /^Buy/ }).click();
    await expect(page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow .* · pays up to 106831\.9× · you called this$/ })).toBeEnabled();
  });

  test("a call still in flight when the wallet changes reports nothing to the next wallet, which signs in afresh", async ({ page }) => {
    const { relay, signs } = await freeCalls(page);
    let release = () => {};
    relay.hold = new Promise((resolve) => (release = resolve));
    const grid = page.getByRole("table");
    await grid.getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow / }).click();
    await expect(grid.locator("[aria-busy=true]")).toHaveCount(1);
    await page.getByRole("button", { name: /^Account / }).click();
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: /Ethereum wallet/ }).click();
    await expect(grid.locator("[aria-busy=true]")).toHaveCount(0);
    release();
    await expect(grid.getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow .* · you called this$/ })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^Called / })).toHaveCount(0);
    await page.evaluate(() => Object.assign(window, { refuseCalls: { status: 401, error: "session refused: deadline out of range" } }));
    await grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Your wallet couldn't sign in. Tap again to sign in again." })).toBeVisible();
    expect(await signs()).toBe(2);
    await page.evaluate(() => Object.assign(window, { refuseCalls: undefined }));
    await grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Called BTC Up $82,000 at 5.0×." })).toBeVisible();
    expect(await signs()).toBe(3);
  });

  test("a call on an end that's over drops off the grid even while its UTC day is still the next round", async ({ page }) => {
    const short = { ...listed.find((s) => s.id === "BTC-5NOV26-81000_83000-C")!, id: "BTC-5NOV26T0400-81000_83000-C", expiry: Date.UTC(2026, 10, 5, 4) / 1000 };
    const { option_asset, quotable, ...terms } = short;
    await freeCalls(page, [...listed, short], [{ series_id: short.id, account_id: "0x1111111111111111111111111111111111111111", terms, ask: String(400 * USD), at_ms: NOW_MS }]);
    const grid = page.getByRole("table");
    await expect(grid.getByRole("button", { name: /you called this$/ })).toHaveCount(1);
    await page.clock.fastForward(Date.UTC(2026, 10, 5, 7, 5) - NOW_MS);
    await expect(grid.getByRole("button", { name: /^Up · BTC ends above \$82,000 · Today .* · pays up to 25\.0×$/ })).toBeEnabled();
    await expect(grid.getByRole("button", { name: /you called this$/ })).toHaveCount(0);
    await expect(grid.getByRole("group")).toHaveCount(0);
  });

  test("a free call that won shows its points in the result and shares a points card", async ({ page }) => {
    const { relay } = await freeCalls(page);
    await page.getByRole("table").getByRole("button", { name: /^Up · BTC ends above \$81,000 · Tomorrow / }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Called / })).toBeVisible();
    expect(relay.calls).toHaveLength(1);
    const expiry = Date.UTC(2026, 10, 5, 8) / 1000;
    view.get_settlement = { price: String(83_000 * USD), final_at: expiry + 3_900 };
    try {
      await page.clock.fastForward((expiry + 3_900) * 1000 - (await page.evaluate(() => Date.now())));
      await expect(page.getByRole("table").getByRole("group", { name: /^Up · BTC ends above \$81,000 · result · free call · \+400 pts$/ })).toBeVisible();
      await expect(page.getByText(/Your BTC free calls: \+400 points\.$/)).toBeVisible();
      await page.evaluate(() => Object.assign(navigator, { canShare: undefined }));
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Share" }).click();
      expect((await download).suggestedFilename()).toBe("endline-win.png");
    } finally {
      delete view.get_settlement;
    }
  });

  test("drops every cell once the relay's marks fail", async ({ page }) => {
    let up = true;
    await live(page, () => (up ? [{ series_id: "BTC-5NOV26-81000_83000-C", ask: String(400 * USD), vol: 0.4 }] : undefined));
    await expect(page.getByRole("table").getByRole("button")).toHaveCount(1);
    up = false;
    await page.clock.fastForward(5_000);
    await expect(page.getByRole("status").filter({ hasText: "No prices right now" })).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});
