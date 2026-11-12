import type { Locator, Page } from "@playwright/test";
import { connectDemo, dollars, expect, handleOf, money, settle, term, test, valueOf } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
});

const maxLoss = (page: Page) => term(page, "Max loss");
const near = async (balance: Locator, expected: number) => expect.poll(async () => Math.abs((await money(balance)) - expected)).toBeLessThanOrEqual(1);

test("an invalid Other amount never trades the previous amount", async ({ page }) => {
  await connectDemo(page);
  await page.getByRole("radio", { name: "Other" }).click();
  const input = page.getByLabel("Amount in dollars");
  const buy = page.getByRole("button", { name: /^(Buy Up|Enter a valid amount)/ });
  await expect(input).toHaveValue("");
  await expect(buy).toBeDisabled();
  await expect(buy).toHaveText("Enter a valid amount");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect.poll(() => money(maxLoss(page))).toBe(0);
  await input.fill("99");
  await expect.poll(() => money(maxLoss(page))).toBe(99);
  await expect(buy).toBeEnabled();
  for (const text of ["0", "0.99", "-5", "abc", "1e5", "12.345", "0.001", ""]) {
    await input.fill(text);
    await expect(buy).toBeDisabled();
    await expect.poll(() => money(maxLoss(page))).toBe(0);
    await expect(handleOf(page)).toBeVisible();
  }
  await input.fill("12.5");
  await expect.poll(() => money(maxLoss(page))).toBe(12.5);
  await expect(buy).toHaveText("Buy Up · $12.50");
  await expect(buy).toBeEnabled();
});

const expectNames = async (radios: Locator, names: string[]) => {
  await expect(radios).toHaveCount(names.length);
  for (const [i, name] of names.entries()) await expect(radios.nth(i)).toHaveAccessibleName(name);
};

const openAddFunds = async (page: Page) => {
  await page.getByRole("button", { name: /^(Add funds|Balance, add funds)$/ }).click();
  return page.getByRole("dialog", { name: "Add funds" });
};

test("deposit addresses match the selected chain, and so does the warning", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectDemo(page);
  const sheet = await openAddFunds(page);
  for (const [chain, pattern] of [
    ["Base", /^0x[0-9a-f]{40}$/],
    ["Solana", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/],
  ] as const) {
    await sheet.getByRole("radiogroup", { name: "Network" }).getByRole("radio", { name: chain, exact: true }).click();
    await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("1000");
    await sheet.getByRole("button", { name: "Get deposit address" }).click();
    await expect(sheet.locator("code")).toHaveText(pattern);
    const send = sheet.getByText("Send exactly").locator("..");
    await expect(send).toHaveText(`Send exactly 1,000 USDC on ${chain}Copy`);
    await send.getByRole("button", { name: "Copy amount", exact: true }).click();
    await expect(send.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("1000");
    await page.clock.runFor(2_000);
    await expect(send.getByRole("button", { name: "Copy amount", exact: true })).toBeVisible();
    await expect(sheet.getByText(/^Only send/)).toHaveText(`Only send USDC on ${chain}. Anything else may be lost.`);
    await sheet.getByRole("button", { name: "Back" }).click();
  }
});

test("the amount to send and copy is exact to the token's last decimal", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await connectDemo(page);
  const sheet = await openAddFunds(page);
  for (const [symbol, typed, shown, chain] of [
    ["SOL", "1.123456789", "1.123456789", "Solana"],
    ["ETH", "0.000000000000000001", "0.000000000000000001", "Base"],
    ["ETH", "1234.500000000000000001", "1,234.500000000000000001", "Base"],
  ] as const) {
    await sheet.getByRole("radio", { name: symbol, exact: true }).click();
    await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill(typed);
    await sheet.getByRole("button", { name: "Get deposit address" }).click();
    const heading = sheet.getByRole("heading", { name: /^Send exactly/ });
    await expect(heading).toHaveText(`Send exactly ${shown} ${symbol} on ${chain}`);
    await expect(heading).toBeFocused();
    await sheet.getByRole("button", { name: "Copy amount", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(typed);
    await sheet.getByRole("button", { name: "Back" }).click();
    await expect(sheet.getByRole("radiogroup", { name: "Network" }).getByRole("radio", { name: chain, exact: true })).toBeFocused();
  }
});

const PENDING_KEY = "pending-deposit:demo.near";
const saved = (page: Page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);
const store = (page: Page, value: string) => page.evaluate(([key, stored]) => localStorage.setItem(key, stored), [PENDING_KEY, value] as const);
const savedAddress = async (page: Page) => JSON.parse((await saved(page)) ?? "null")?.depositAddress;

test("an address past its send-by time is hidden but still checked until refunds are done, then forgotten when nothing was sent", async ({ page }) => {
  await connectDemo(page);
  const now = await page.evaluate(() => Date.now());
  const at = (ms: number) => new Date(now + ms).toISOString();
  const pending = { depositAddress: "0x00000000000000000000000000000000000000aa", amountIn: "25000000", amountOut: "24975000", timeEstimate: 35, sendBefore: at(60_000), deadline: at(60_000 + 2 * 3_600_000), clockOffsetMs: 0, asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 } };
  await store(page, JSON.stringify(pending));
  const sheet = await openAddFunds(page);
  await expect(sheet.locator("code")).toHaveText(pending.depositAddress);
  await page.clock.runFor(61_000);
  await expect(sheet.getByRole("status")).toHaveText("This address has expired. If you already sent, we're still checking. It arrives in your balance or is refunded to your NEAR Intents account.");
  for (const gone of [sheet.locator("code"), sheet.getByRole("img", { name: "Deposit address QR code" }), sheet.getByRole("button", { name: /^Copy/ })]) await expect(gone).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Back" })).toBeVisible();
  await page.clock.fastForward(2 * 3_600_000 + 35_000 + 10 * 60_000 - 3_000);
  await expect(sheet.getByRole("status")).toHaveText("This address has expired. If you already sent, we're still checking. It arrives in your balance or is refunded to your NEAR Intents account.");
  expect(await savedAddress(page)).toBe(pending.depositAddress);
  await page.clock.runFor(3_000);
  await expect(sheet.getByRole("status")).toHaveText("This address has expired. Get a new one.");
  await expect.poll(() => saved(page)).toBeNull();
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(sheet.getByRole("button", { name: "Get deposit address" })).toBeVisible();
});

test("a deposit reaching its send-by time never overwrites a newer one another tab saved", async ({ page }) => {
  await connectDemo(page);
  const now = await page.evaluate(() => Date.now());
  const at = (ms: number) => new Date(now + ms).toISOString();
  const deposit = (depositAddress: string) => ({ depositAddress, amountIn: "25000000", amountOut: "24975000", timeEstimate: 35, sendBefore: at(60_000), deadline: at(60_000 + 2 * 3_600_000), clockOffsetMs: 0, asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 } });
  await store(page, JSON.stringify(deposit("0x00000000000000000000000000000000000000aa")));
  const sheet = await openAddFunds(page);
  await expect(sheet.locator("code")).toHaveText("0x00000000000000000000000000000000000000aa");
  await store(page, JSON.stringify({ ...deposit("0x00000000000000000000000000000000000000bb"), sendBefore: at(3_600_000) }));
  await page.clock.runFor(61_000);
  await expect(sheet.getByRole("status")).toHaveText(/^This address has expired\. If you already sent/);
  expect(await savedAddress(page)).toBe("0x00000000000000000000000000000000000000bb");
});

test("a new address replaces whatever another tab saved, so the latest deposit is the one reopened", async ({ page }) => {
  await connectDemo(page);
  const sheet = await openAddFunds(page);
  await expect(sheet.getByRole("button", { name: "Get deposit address" })).toBeVisible();
  const now = await page.evaluate(() => Date.now());
  const at = (ms: number) => new Date(now + ms).toISOString();
  await store(page, JSON.stringify({ depositAddress: "0x00000000000000000000000000000000000000bb", amountIn: "25000000", amountOut: "24975000", timeEstimate: 35, sendBefore: at(3_600_000), deadline: at(3 * 3_600_000), clockOffsetMs: 0, asset: { assetId: "nep141:base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 } }));
  await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("25");
  await sheet.getByRole("button", { name: "Get deposit address" }).click();
  const address = await sheet.locator("code").textContent();
  expect(address).not.toBe("0x00000000000000000000000000000000000000bb");
  await expect.poll(() => savedAddress(page)).toBe(address);
});

test("a transfer seen after the send-by time stays saved and shows its progress", async ({ page }) => {
  await connectDemo(page);
  let sheet = await openAddFunds(page);
  await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("25");
  await sheet.getByRole("button", { name: "Get deposit address" }).click();
  await expect(sheet.locator("code")).toBeVisible();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate((key) => {
    const pending = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...pending, sendBefore: new Date(Date.now() - 1_000).toISOString() }));
  }, PENDING_KEY);
  const address = await savedAddress(page);

  sheet = await openAddFunds(page);
  await expect(sheet.getByRole("status")).toHaveText(/^This address has expired\. If you already sent/);
  await page.clock.runFor(6_000);
  await expect(sheet.locator("[aria-current=step]")).toHaveText(/^(Transfer seen|Converting to USDC)$/);
  await expect(sheet.locator("code")).toHaveCount(0);
  expect(await savedAddress(page)).toBe(address);
});

test("Back in a tab with an older address leaves the newer one another tab saved", async ({ page }) => {
  await connectDemo(page);
  const sheet = await openAddFunds(page);
  await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("25");
  await sheet.getByRole("button", { name: "Get deposit address" }).click();
  await expect(sheet.locator("code")).toBeVisible();
  const newer = JSON.stringify({ ...JSON.parse((await saved(page)) ?? "{}"), depositAddress: "0x00000000000000000000000000000000000000bb" });
  await store(page, newer);
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(sheet.getByRole("button", { name: "Get deposit address" })).toBeVisible();
  expect(await saved(page)).toBe(newer);
});

test("Add funds starts on USDC, lists its cheapest networks first and prices the amount", async ({ page }) => {
  await connectDemo(page);
  const sheet = await openAddFunds(page);
  const tokens = sheet.getByRole("radiogroup", { name: "You send" }).getByRole("radio");
  const networks = sheet.getByRole("radiogroup", { name: "Network" }).getByRole("radio");
  const amount = sheet.getByRole("textbox", { name: "Amount to deposit" });
  const get = sheet.getByRole("button", { name: "Get deposit address" });
  await expectNames(tokens, ["USDC", "USDT", "ETH", "BTC", "SOL"]);
  await expect(tokens.first()).toHaveAttribute("aria-checked", "true");
  await expectNames(networks, ["Base", "Arbitrum", "Solana", "Polygon", "BNB Chain", "Avalanche", "Ethereum", "Gnosis"]);
  await expect(networks.first()).toHaveAttribute("aria-checked", "true");
  await expect(get).toBeInViewport();

  await networks.filter({ hasText: "Ethereum" }).click();
  await sheet.getByRole("radio", { name: "BTC", exact: true }).click();
  await expectNames(networks, ["Bitcoin"]);
  await expect(networks).toHaveAttribute("aria-checked", "true");
  await amount.fill("0.01");
  await expect(sheet.getByText(/^≈/)).toHaveText("≈ $800");
  await sheet.getByRole("radio", { name: "ETH", exact: true }).click();
  await expectNames(networks, ["Base", "Ethereum", "Abstract"]);
  await expect(networks.first()).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByText(/^≈/)).toHaveText("≈ $20.00");
  for (const text of ["", "abc", "0.0000000000000000001"]) {
    await amount.fill(text);
    await expect(sheet.getByText(/^≈/)).toHaveCount(0);
    await expect(get).toBeDisabled();
  }

  await sheet.getByRole("radio", { name: "USDC", exact: true }).click();
  const tooLarge = sheet.getByText("That amount is too large.");
  await amount.fill(`${"9".repeat(33)}.999999`);
  await expect(tooLarge).toHaveCount(0);
  await expect(get).toBeEnabled();
  for (const text of [`1${"0".repeat(33)}`, "9".repeat(300)]) {
    await amount.fill(text);
    await expect(tooLarge).toBeVisible();
    await expect(sheet.getByText(/^≈/)).toHaveCount(0);
    await expect(get).toBeDisabled();
  }
});

test("a deposit reopens on its address until it is credited, Back drops it, and Back hides once the transfer is seen", async ({ page }) => {
  await connectDemo(page);
  let sheet = await openAddFunds(page);
  await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("25");
  await sheet.getByRole("button", { name: "Get deposit address" }).click();
  const address = await sheet.locator("code").textContent();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();

  sheet = await openAddFunds(page);
  await expect(sheet.locator("code")).toHaveText(address ?? "");
  await expect(sheet.locator("[aria-current=step]")).toHaveText("Waiting for your transfer");
  await sheet.getByRole("button", { name: "Back" }).focus();
  await page.clock.runFor(6_000);
  await expect(sheet.locator("[aria-current=step]")).toHaveText("Transfer seen");
  await expect(sheet.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(sheet.getByRole("heading", { name: "Deposit of 25 USDC on Base" })).toBeFocused();
  for (const gone of [sheet.locator("code"), sheet.getByRole("img", { name: "Deposit address QR code" }), sheet.getByRole("button", { name: /^Copy/ }), sheet.getByText(/^Only send/), sheet.getByText("Send before")]) await expect(gone).toHaveCount(0);
  await page.clock.runFor(14_000);
  await expect(sheet.locator("[aria-current=step]")).toHaveText(/^Credited/);
  await expect.poll(() => money(page.locator("header number-flow-react:visible"))).toBe(274);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  sheet = await openAddFunds(page);
  await expect(sheet.locator("code")).toHaveCount(0);

  await sheet.getByRole("textbox", { name: "Amount to deposit" }).fill("25");
  await sheet.getByRole("button", { name: "Get deposit address" }).click();
  await expect(sheet.locator("code")).toBeVisible();
  await sheet.getByRole("button", { name: "Back" }).click();
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  sheet = await openAddFunds(page);
  await expect(sheet.locator("code")).toHaveCount(0);
});

test("stepper and presets move the price to beat within the listed strikes", async ({ page }) => {
  const handle = handleOf(page);
  const lower = page.getByRole("button", { name: "Lower price to beat" });
  const higher = page.getByRole("button", { name: "Higher price to beat" });
  const min = Number(await handle.getAttribute("aria-valuemin"));
  const max = Number(await handle.getAttribute("aria-valuemax"));
  while (await lower.isEnabled()) await lower.click();
  await expect(handle).toHaveAttribute("aria-valuenow", String(min));
  while (await higher.isEnabled()) await higher.click();
  await expect(handle).toHaveAttribute("aria-valuenow", String(max));
  for (const name of ["Safer", "Balanced", "Bolder"]) {
    const preset = page.getByRole("radio", { name: new RegExp(`^${name}`) });
    await preset.click();
    await expect(preset).toHaveAttribute("aria-checked", "true");
    await expect(handle).toHaveAttribute("aria-valuenow", String(await money(preset)));
  }
});

test("320px Pro choices show full direction, price and amount labels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const name of ["Direction", "Suggested prices to beat", "You pay"]) {
    const group = page.getByRole("radiogroup", { name, exact: true });
    await group.scrollIntoViewIfNeeded();
    for (const button of await group.getByRole("radio").all()) {
      expect(await button.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
      expect(await button.locator("span").evaluateAll((spans) => spans.filter((span) => getComputedStyle(span).textOverflow === "ellipsis").some((span) => span.scrollWidth > span.clientWidth))).toBe(false);
    }
  }
});

test("ticket has no dead gap and no scrollbar", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "desktop layout");
  const gap = async () => {
    const chips = await page.getByRole("radiogroup", { name: "You pay" }).boundingBox();
    const summary = await maxLoss(page).locator("xpath=ancestor::dl").boundingBox();
    return (summary?.y ?? 0) - ((chips?.y ?? 0) + (chips?.height ?? 0));
  };
  expect(await gap()).toBeLessThanOrEqual(24);
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator("aside").evaluate((aside) => aside.scrollHeight - aside.clientHeight)).toBeLessThanOrEqual(0);
    const buy = await page.getByRole("button", { name: "Connect wallet" }).boundingBox();
    expect((buy?.y ?? Infinity) + (buy?.height ?? 0)).toBeLessThanOrEqual(height);
  }
});

test("settlement info wraps inside its bubble and clears the ticket", async ({ page }) => {
  await page.getByRole("button", { name: "How the final price is set" }).click();
  const panel = page.getByText("Final price is the median");
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = await panel.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const aside = await page.locator("aside").boundingBox();
  if (!aside) throw new Error("no ticket");
  const overlaps = box.x < aside.x + aside.width && aside.x < box.x + box.width && box.y < aside.y + aside.height && aside.y < box.y + box.height;
  expect(overlaps).toBe(false);
});

test("ticket shows the cap two steps past the line on the winning side, paying more than the max loss", async ({ page }) => {
  for (const [name, side] of [
    ["Up", "above"],
    ["Down", "below"],
  ] as const) {
    await page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: new RegExp(`^${name}`) }).click();
    const strike = await valueOf(handleOf(page));
    await expect(async () => {
      const scenario = new RegExp(`^If BTC ends ${side} `);
      const [price] = dollars((await page.locator("dt", { hasText: scenario }).textContent()) ?? "");
      expect(price).toBe(name === "Up" ? strike + 2_000 : strike - 2_000);
      expect(await money(term(page, scenario))).toBeGreaterThan(await money(maxLoss(page)));
    }).toPass();
  }
});

test("utility classes win over base styles", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Ends" })).toHaveCSS("font-family", /^"Geist Mono/);
  await page.getByRole("radio", { name: "Other" }).click();
  await expect(page.getByLabel("Amount in dollars")).toBeFocused();
  await expect(page.getByLabel("Amount in dollars")).toHaveCSS("outline-style", "none");
});

test("buy, see it in positions, sell it back", async ({ page }) => {
  await connectDemo(page);
  const balance = page.locator("header number-flow-react:visible");
  const before = await money(balance);
  await page.getByRole("button", { name: "Buy Up · $25" }).click();
  const confirm = page.getByRole("button", { name: /^Buy for \$/ });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  const paid = Number((await confirm.textContent())?.replace(/[^\d.]/g, ""));
  expect(paid).toBeGreaterThan(0);
  expect(paid).toBeLessThanOrEqual(before);
  if (paid > 25) await expect(page.getByRole("dialog")).toContainText("Above the $25.00 you picked");
  const terms = await page.getByRole("dialog").innerText();
  const title = /BTC (Up|Down) \$[\d,]+/.exec(terms)?.[0] ?? "no title";
  const ends = /Ends .+? UTC/.exec(terms)?.[0] ?? "no end";
  await confirm.click();
  await expect(page.getByText("You're in")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not now" }).click();
  await near(balance, before - paid);

  await page.getByRole("link", { name: /Positions/ }).click();
  const card = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .filter({ hasText: ends })
    .filter({ has: page.getByText("Active", { exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Sell back" }).click();
  const sell = page.getByRole("button", { name: /^Sell back for \$/ });
  await expect(sell).toBeVisible({ timeout: 10_000 });
  const got = Number((await sell.textContent())?.replace(/[^\d.]/g, ""));
  await sell.click();
  await expect(page.getByText("Sold", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await near(balance, before - paid + got);
});

test("a chip group is one Tab stop and arrow keys pick within it", async ({ page }) => {
  const group = page.getByRole("radiogroup", { name: "You pay" });
  await group.getByRole("radio", { name: "$25", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const fifty = group.getByRole("radio", { name: "$50", exact: true });
  await expect(fifty).toBeFocused();
  await expect(fifty).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => money(maxLoss(page))).toBe(50);
  await page.keyboard.press("Tab");
  await expect(group.locator(":focus")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(fifty).toBeFocused();
});

test("a pay link fills the amount field with the same budget, or falls back to $25", async ({ page }) => {
  await page.goto("/app?pay=12");
  await settle(handleOf(page));
  await connectDemo(page);
  const buy = page.getByRole("button", { name: /^Buy Up/ });
  await expect(page.getByLabel("Amount in dollars")).toHaveValue("12");
  await expect.poll(() => money(maxLoss(page))).toBe(12);
  await expect(buy).toHaveText("Buy Up · $12");
  const input = page.getByLabel("Amount in dollars");
  await input.clear();
  await input.pressSequentially("100");
  await expect(input).toHaveValue("100");
  await expect(buy).toHaveText("Buy Up · $100");
  for (const pay of ["12.345", "0.001", "0.5"]) {
    await page.goto(`/app?pay=${pay}`);
    await settle(handleOf(page));
    await expect(page.getByRole("radio", { name: "$25", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => money(maxLoss(page))).toBe(25);
  }
});

test("arrow keys move from the focused chip, and Direction picks the same way", async ({ page }) => {
  const pay = page.getByRole("radiogroup", { name: "You pay" });
  await pay.getByRole("radio", { name: "$10", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const twentyFive = pay.getByRole("radio", { name: "$25", exact: true });
  await expect(twentyFive).toBeFocused();
  await expect(twentyFive).toHaveAttribute("aria-checked", "true");

  const direction = page.getByRole("radiogroup", { name: "Direction" });
  await direction.getByRole("radio", { name: /^Up/ }).focus();
  await page.keyboard.press("ArrowRight");
  const down = direction.getByRole("radio", { name: /^Down/ });
  await expect(down).toBeFocused();
  await expect(down).toHaveAttribute("aria-checked", "true");
  await expect(down).toHaveAttribute("tabindex", "0");
  await expect(direction.getByRole("radio", { name: /^Up/ })).toHaveAttribute("tabindex", "-1");
});

test("Add funds shows USDC and deposits, and no test USDC off testnet", async ({ page }) => {
  await connectDemo(page);
  await page.getByRole("button", { name: /add funds/i }).filter({ visible: true }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/^Balance /)).toHaveText("Balance $250");
  await expect(sheet.getByRole("radiogroup", { name: "You send" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /test USDC/ })).toHaveCount(0);
});
