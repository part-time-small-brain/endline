import { connectDemo, expect, handleOf, money, settle, term, test } from "./fixtures.ts";

const COPY_LEAKS = /testnet|play money|test funds|mock|example|planned/i;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
  await connectDemo(page);
});

test("an Up that ended past its cap collects the cap in USDC, straight into the balance", async ({ page }) => {
  const balance = page.locator("header number-flow-react:visible");
  const before = await money(balance);
  await page.getByRole("link", { name: /Positions/ }).click();
  const banner = page.getByRole("status").filter({ hasText: "ready to collect" });
  await banner.getByRole("button", { name: "Collect" }).click();

  const collected = page.getByRole("status").filter({ hasText: "Collected" }).first();
  await expect(collected).toHaveText("Collected $40.00");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "BTC Up $80,000" }) });
  await expect(card).toContainText("Capped at $82,000");
  await expect(card.getByRole("term")).toContainText(["Paid", "Collected", "P&L"]);
  await expect(card.getByRole("definition").nth(1)).toHaveText("$40.00");
  await expect.poll(() => money(balance)).toBeCloseTo(before + 40, 2);
});

test("a final payout waits one minute before Collect becomes available", async ({ page }) => {
  const start = Math.ceil((await page.evaluate(() => Date.now())) / 1_000) * 1_000 + 1_000;
  await page.clock.pauseAt(start);
  await page.reload();
  await connectDemo(page);
  await page.getByRole("link", { name: /Positions/ }).click();
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "BTC Up $79,000" }) });
  await expect(card).toContainText("Proposed final price $81,420");
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "BTC Down $80,000" }) })).toContainText("Waiting for the final price");

  await page.clock.fastForward(40 * 60_000);
  await expect(card).toContainText("Final price $81,420. Preparing your payout");
  await expect(card).not.toContainText("Proposed");
  await expect(card).not.toContainText("final at");
  await expect(card.getByRole("button", { name: "Collect", exact: true })).toHaveCount(0);
  await page.clock.fastForward(59_000);
  await expect(card).toContainText("Preparing your payout");
  await expect(card.getByRole("button", { name: "Collect", exact: true })).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect(card.getByRole("button", { name: "Collect", exact: true })).toBeVisible();
  await expect(card).not.toContainText("Preparing your payout");
});

test("a position at a width no market maker lists shows its cap, no value without a mark, and can't be sold back", async ({ page }) => {
  await page.getByRole("link", { name: /Positions/ }).click();
  const card = page.getByRole("article").filter({ hasText: "Capped at $86,000" });
  await expect(card.getByRole("heading")).toHaveText("BTC Up $85,500");
  await expect(term(card, "Value now")).toHaveText("—");
  await expect(term(card, "P&L")).toHaveText("—");
  await expect(card.getByRole("button", { name: "Sell back unavailable" })).toBeDisabled();
});

test("the app names the network once, in the header, and never shows raw ids", async ({ page }) => {
  await expect(page.locator("header").getByText("Demo", { exact: true })).toHaveCount(1);
  expect(await page.locator("main").innerText()).not.toMatch(COPY_LEAKS);

  await page.getByRole("button", { name: "Buy Up · $25" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /^Buy for \$/ })).toBeVisible({ timeout: 10_000 });
  expect(await sheet.innerText()).not.toMatch(/[A-Z]{3}-\d{1,2}[A-Z]{3}\d{2}-|testnet|demo/i);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: /Positions/ }).click();
  await expect(page.getByRole("article").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(COPY_LEAKS);
});

test("P&L is green for a gain and red for a loss", async ({ page }) => {
  await page.getByRole("link", { name: /Positions/ }).click();
  const pnls = page.locator("article dt", { hasText: "P&L" }).locator("xpath=following-sibling::dd[1]/span");
  await expect(pnls.first()).toBeVisible();
  const rows = await pnls.evaluateAll((spans) => {
    const colorOf = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const up = colorOf("--up-ink");
    const down = colorOf("--down-ink");
    return spans.map((span) => ({ text: span.textContent ?? "", tone: getComputedStyle(span).color === up ? "up" : getComputedStyle(span).color === down ? "down" : "other" }));
  });
  const gains = rows.filter((r) => /^\+\$(?!0\.00)/.test(r.text));
  const losses = rows.filter((r) => /^[-−]/.test(r.text));
  expect(gains.length).toBeGreaterThan(0);
  expect(losses.length).toBeGreaterThan(0);
  expect(gains.every((r) => r.tone === "up")).toBe(true);
  expect(losses.every((r) => r.tone === "down")).toBe(true);
});
