import type { Locator, Page } from "@playwright/test";
import { connectDemo, dollars, expect, money, openPopover, settle, sideways, test } from "./fixtures.ts";

test("Lite is the default and Pro persists across reload", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  await expect(page.getByRole("img", { name: /over the last 24 hours/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Price to beat" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Pro", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Price to beat" })).toBeVisible();
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
});

test("Lite buys through the same confirm sheet", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  await connectDemo(page);
  const ticketPayout = await page.getByLabel("Maximum payout").innerText();
  await page.getByRole("button", { name: "Buy Up · $25" }).click();
  const sheet = page.getByRole("dialog");
  const confirm = sheet.getByRole("button", { name: /^Buy for \$/ });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toContainText("Capped at");
  await expect(sheet.getByText("Win up to", { exact: true })).toBeVisible();
  await expect(sheet.getByText(ticketPayout, { exact: true })).toBeVisible();
  await confirm.click();
  await expect(sheet.getByText("You're in")).toBeVisible({ timeout: 10_000 });
  await expect(sheet.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Turn on auto-collect", exact: true }).click();
  await expect(sheet.getByText("Auto-collect is on")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Not now", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
});

const CHIP_LABELS = ["End date", "Trade direction", "Price to beat", "Trade amount"] as const;

async function ready(page: Page) {
  await page.goto("/app");
  await expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
  await connectDemo(page);
}

async function selection(page: Page) {
  return Promise.all(CHIP_LABELS.map((name) => page.getByRole("button", { name, exact: true }).innerText()));
}

async function fitsHorizontally(page: Page, panel: Locator) {
  await expect(panel).toBeVisible();
  expect.soft(await sideways(page)).toBeLessThanOrEqual(0);
  const bounds = await panel.boundingBox();
  expect.soft(bounds!.x).toBeGreaterThanOrEqual(0);
  expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test("every sentence edit updates the ticket without exposing trading jargon", async ({ page }) => {
  await ready(page);
  const payout = page.getByLabel("Maximum payout");
  let previous = await payout.innerText();
  const changedPayout = async () => {
    await expect(payout).toHaveText(/^\$[\d,.]+$/);
    await expect(payout).not.toHaveText(previous);
    expect(await money(payout)).toBeGreaterThan(25);
    previous = await payout.innerText();
  };

  const dates = await openPopover(page, "End date");
  const later = dates.getByRole("radio").last();
  const day = (await later.innerText()).split(" · ")[0] ?? "";
  await later.click();
  await expect(later).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "End date", exact: true })).toContainText(day);
  await fitsHorizontally(page, dates);
  await changedPayout();

  const directions = await openPopover(page, "Trade direction");
  const down = directions.getByRole("radio", { name: /^Down/ });
  await down.click();
  await expect(down).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toContainText("below");
  await expect(page.getByRole("button", { name: "Buy Down · $25", exact: true })).toBeEnabled();
  await changedPayout();

  const prices = await openPopover(page, "Price to beat");
  const lower = prices.getByRole("radio").first();
  const [strike] = dollars(await lower.innerText());
  await lower.click();
  await expect(lower).toHaveAttribute("aria-checked", "true");
  expect(await money(page.getByRole("button", { name: "Price to beat", exact: true }))).toBe(strike);
  await changedPayout();

  const amounts = await openPopover(page, "Trade amount");
  const fifty = amounts.getByRole("radio", { name: "$50", exact: true });
  await fifty.click();
  await expect(fifty).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$50");
  await expect(page.getByRole("button", { name: "Buy Down · $50", exact: true })).toBeEnabled();
  await changedPayout();
  await page.keyboard.press("Escape");

  const sentence = page.getByLabel("Trade sentence");
  await expect(sentence).toContainText("BTC ends below", { useInnerText: true });
  await expect(sentence).toContainText(/I put\s+\$50\s*, I win up to/, { useInnerText: true });
  await expect(page.getByLabel("Trade ticket")).not.toContainText(/nep(?:141|245):|[A-Z]+-\d{2}[A-Z]{3}\d{2}-|RFQ|breakeven|collateral|token_diff|strike|premium|slippage/i, { useInnerText: true });
  await expect(sentence).not.toContainText(/\b(call|put option|series|contract|balanced|bolder|safer)\b/i, { useInnerText: true });
});

test("mode switches preserve selection and budget, and Lite remains editable after Pro", async ({ page }) => {
  await ready(page);
  await (await openPopover(page, "Trade direction")).getByRole("radio", { name: /^Down/ }).click();
  await (await openPopover(page, "End date")).getByRole("radio").last().click();
  await (await openPopover(page, "Price to beat")).getByRole("radio").first().click();
  await (await openPopover(page, "Trade amount")).getByRole("radio", { name: "$50", exact: true }).click();
  await page.keyboard.press("Escape");
  const before = await selection(page);

  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("radio", { name: /^Down/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "$50", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(Number(await page.getByRole("slider", { name: "Price to beat" }).getAttribute("aria-valuenow"))).toBe(dollars(before[CHIP_LABELS.indexOf("Price to beat")] ?? "")[0]);
  await expect(page.getByRole("button", { name: "Buy Down · $50", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Lite", exact: true }).click();
  expect(await selection(page)).toEqual(before);
  const oldPayout = await money(page.getByLabel("Maximum payout"));
  await (await openPopover(page, "Trade amount")).getByRole("radio", { name: "$100", exact: true }).click();
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$100");
  await expect(page.getByRole("button", { name: "Buy Down · $100", exact: true })).toBeEnabled();
  await expect.poll(() => money(page.getByLabel("Maximum payout"))).toBeGreaterThan(oldPayout * 1.9);
  await (await openPopover(page, "Trade direction")).getByRole("radio", { name: /^Up/ }).click();
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toContainText("above");
  await expect(page.getByRole("button", { name: "Buy Up · $100", exact: true })).toBeEnabled();
});

test("invalid Other budgets clear payout and cannot buy a stale amount", async ({ page }) => {
  await ready(page);
  const amounts = await openPopover(page, "Trade amount");
  await amounts.getByRole("radio", { name: "Other", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Amount in dollars" });
  const buy = page.getByRole("button", { name: /^(Buy Up|Enter a valid amount)/ });
  const invalid = async () => {
    await expect(buy).toBeDisabled();
    await expect(buy).toHaveText("Enter a valid amount");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(amounts.getByRole("alert")).toHaveText("Enter $1 or more, using whole cents.");
    await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("—");
    await expect(page.getByLabel("Maximum payout")).toHaveText("—");
    await expect(page.getByLabel("Trade ticket").getByText("Max loss", { exact: false })).toHaveText("Max loss —");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await fitsHorizontally(page, amounts);
  };
  await expect(input).toHaveValue("");
  await invalid();
  for (const text of ["0", "0.99", "-5", "abc", "1e5", "12.345", "0.001", ""]) {
    await input.fill("99");
    await expect(buy).toHaveText("Buy Up · $99");
    await expect(buy).toBeEnabled();
    await expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
    await input.fill(text);
    await invalid();
  }
  await page.keyboard.press("Escape");
  await expect(amounts).toBeHidden();
  await expect(buy).toHaveText("Enter a valid amount");
  await openPopover(page, "Trade amount");
  await input.fill("12.5");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(amounts.getByRole("alert")).toHaveCount(0);
  await expect(buy).toHaveText("Buy Up · $12.50");
  await expect(buy).toBeEnabled();
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$12.50");
  await expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
  await expect.poll(() => page.getByLabel("Maximum payout").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await fitsHorizontally(page, amounts);
  await page.screenshot({ path: test.info().outputPath(`${test.info().project.name}-trade-amount-custom.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(amounts).toBeHidden();
  const trigger = page.getByRole("button", { name: "Trade amount", exact: true });
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText("$12.50");
  await expect(buy).toHaveText("Buy Up · $12.50");
});

test("Up and Down show full payout at the cap on the winning side", async ({ page }) => {
  await ready(page);
  for (const [side, direction, offset] of [["Up", "above", 2_000], ["Down", "below", -2_000]] as const) {
    await (await openPopover(page, "Trade direction")).getByRole("radio", { name: new RegExp(`^${side}`) }).click();
    await page.keyboard.press("Escape");
    const strike = await money(page.getByRole("button", { name: "Price to beat", exact: true }));
    const scenario = page.getByText(new RegExp(`^Full payout if BTC ends ${direction} `));
    await expect(scenario).toBeVisible();
    expect(await money(scenario)).toBe(strike + offset);
    expect(await money(page.getByLabel("Maximum payout"))).toBeGreaterThan(25);
    await expect(page.getByRole("button", { name: `Buy ${side} · $25`, exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "About estimated chance", exact: true })).toHaveAccessibleDescription(/^\d+% estimated chance$/);
  }
  const chance = await openPopover(page, "About estimated chance");
  await expect(chance).toContainText("Not the chance of receiving the maximum payout or making a profit.");
  await expect(chance).toContainText("Maximum payout includes your stake.");
});

test("sentence controls expose selected values without announcing every price poll", async ({ page }) => {
  await ready(page);
  await expect(page.getByRole("button", { name: "End date", exact: true })).toHaveAccessibleDescription(/Tomorrow/);
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toHaveAccessibleDescription("Up, ends above");
  await expect(page.getByRole("button", { name: "Price to beat", exact: true })).toHaveAccessibleDescription(/\$81,000/);
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveAccessibleDescription("$25");
  await expect(page.getByRole("button", { name: "About estimated chance", exact: true })).toHaveAccessibleDescription(/% estimated chance/);
  await expect(page.getByLabel("Maximum payout")).toHaveAttribute("aria-live", "off");
});

test("Lite falls back and toggles when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }));
  await page.goto("/app");
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Price to beat" })).toBeVisible();
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("trade-mode storage changes sync across real tabs without reload", async ({ page, context }) => {
  await page.goto("/app");
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  const other = await context.newPage();
  try {
    await other.clock.install({ time: await page.evaluate(() => Date.now()) });
    await other.goto("/app");
    await expect(other.getByLabel("Trade sentence")).toBeVisible();
    await page.getByRole("button", { name: "Pro", exact: true }).click();
    await expect(other.getByRole("button", { name: "Pro", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(other.getByRole("slider", { name: "Price to beat" })).toBeVisible();
    expect(await other.evaluate(() => localStorage.getItem("trade-mode"))).toBe("pro");
    await other.getByRole("button", { name: "Lite", exact: true }).click();
    await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Trade sentence")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("trade-mode"))).toBe("lite");
  } finally {
    await other.close();
  }
});

test("wrapped sentence pills keep visible space between rows", async ({ page }) => {
  await ready(page);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await Promise.all(CHIP_LABELS.map((name) => page.getByRole("button", { name, exact: true }).boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x)) continue;
        const gap = Math.max(a.y - b.y - b.height, b.y - a.y - a.height);
        expect.soft(gap, `${width}px: ${CHIP_LABELS[i]} / ${CHIP_LABELS[j]}`).toBeGreaterThanOrEqual(8);
      }
    }
  }
});

test("header controls follow visual order and stay usable with wide account values", async ({ page }) => {
  await ready(page);
  const header = page.locator("header");
  for (const width of [320, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = await header.evaluate((element) => [...element.querySelectorAll<HTMLElement>("a, button")]
      .filter((control) => control.getClientRects().length > 0 && control.tabIndex >= 0)
      .map((control, index) => {
        const box = control.getBoundingClientRect();
        return { index, x: box.x, center: box.y + box.height / 2 };
      }));
    const visual = [...controls].sort((a, b) => Math.abs(a.center - b.center) > 4 ? a.center - b.center : a.x - b.x);
    expect.soft(visual.map((control) => control.index), `${width}px focus order`).toEqual(controls.map((control) => control.index));
    for (const control of [header.getByRole("button", { name: "Balance, add funds", exact: true }), header.getByRole("button", { name: /^Account / })]) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox();
      expect.soft(box!.width, `${width}px wallet width`).toBeGreaterThanOrEqual(44);
      expect.soft(box!.height, `${width}px wallet height`).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 640, height: 900 });
  await header.getByText("Demo", { exact: true }).evaluate((element) => { element.textContent = "Testnet"; });
  await header.getByRole("button", { name: "Balance, add funds", exact: true }).evaluate((element) => { element.textContent = "$100,000"; });
  for (const control of [header.getByRole("navigation", { name: "App", exact: true }), header.getByRole("group", { name: "Trade view", exact: true })]) {
    expect.soft(await control.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

async function phoneHeaderRows(page: Page, label: string, trade = true) {
  const header = page.locator("header").first();
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const center = (b: { y: number; height: number }) => b.y + b.height / 2;
  const wallet = await header.getByRole("button", { name: /^(Connect|Balance, add funds|Account .+)$/ }).all();
  const first = await Promise.all([header.getByRole("link", { name: "Endline home" }), header.getByText(/^(Demo|Testnet)$/), ...wallet].map(box));
  const nav = await box(header.getByRole("navigation", { name: "App", exact: true }));
  const views = await header.getByRole("group", { name: "Trade view", exact: true }).all();
  for (const b of first) expect.soft(Math.abs(center(b) - center(first[0]!)), `${label} first row`).toBeLessThanOrEqual(2);
  expect.soft(nav.y, `${label} navigation below the wallet`).toBeGreaterThanOrEqual(Math.max(...first.map((b) => b.y + b.height)));
  expect(views, `${label} view toggle`).toHaveLength(trade ? 1 : 0);
  if (trade) {
    const toggle = await box(views[0]!);
    expect.soft(Math.abs(center(toggle) - center(nav)), `${label} toggle beside tabs`).toBeLessThanOrEqual(2);
    expect.soft(toggle.x - (nav.x + nav.width), `${label} toggle fills the row`).toBeLessThanOrEqual(12);
    expect.soft(Math.abs(toggle.x + toggle.width - (first.at(-1)!.x + first.at(-1)!.width)), `${label} toggle right edge`).toBeLessThanOrEqual(1);
  }
  const controls = await header.evaluate((element) => [...element.querySelectorAll<HTMLElement>("a, button")]
    .filter((control) => control.getClientRects().length > 0)
    .map((control) => control.getBoundingClientRect()));
  const centers = controls.map(center).sort((a, b) => a - b);
  expect.soft(centers.filter((c, i) => i === 0 || c - centers[i - 1]! > 4).length, `${label} rows`).toBe(2);
  for (const b of controls) {
    expect.soft(Math.min(b.width, b.height), `${label} tap target`).toBeGreaterThanOrEqual(44);
    expect.soft(b.x >= 0 && b.x + b.width <= page.viewportSize()!.width, `${label} control in viewport`).toBe(true);
  }
  expect.soft(await sideways(page), `${label} sideways`).toBeLessThanOrEqual(0);
}

test("phone header puts the wallet on one row and the tabs with the view toggle on the next, on every screen", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
  const header = page.locator("header").first();
  for (const wallet of ["disconnected", "connected"]) {
    if (wallet === "connected") {
      await header.getByRole("button", { name: "Lite", exact: true }).click();
      await connectDemo(page);
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of ["Lite", "Pro", "Tap"]) {
        await header.getByRole("button", { name: view, exact: true }).click();
        await phoneHeaderRows(page, `${wallet} ${width}px ${view}`);
      }
      await header.getByRole("link", { name: /^Positions/ }).click();
      await expect(page).toHaveURL(/\/positions$/);
      await phoneHeaderRows(page, `${wallet} ${width}px Positions`, false);
      await header.getByRole("link", { name: "Trade", exact: true }).click();
    }
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await header.getByText("Demo", { exact: true }).evaluate((element) => { element.textContent = "Testnet"; });
  await header.getByRole("button", { name: "Balance, add funds", exact: true }).evaluate((element) => { element.textContent = "$100,000"; });
  await phoneHeaderRows(page, "wide values 320px");
});

test("Lite keeps its action and editable values usable on narrow phones and tablets", async ({ page }) => {
  await ready(page);
  for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: "Buy Up · $25", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Trade ticket").getByText("Max loss", { exact: false })).toBeInViewport({ ratio: 1 });
    for (const label of [...CHIP_LABELS, "About estimated chance"]) {
      const trigger = page.getByRole("button", { name: label, exact: true });
      const bounds = await trigger.boundingBox();
      expect(bounds!.width, label).toBeGreaterThanOrEqual(44);
      expect(bounds!.height, label).toBeGreaterThanOrEqual(44);
      const panel = await openPopover(page, label);
      await settle(panel);
      await fitsHorizontally(page, panel);
      await expect(panel).toBeInViewport({ ratio: 1 });
      const content = panel.locator(":scope > span");
      expect(await content.evaluate((element) => element.scrollWidth - element.clientWidth), label).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await (await openPopover(page, "End date")).getByRole("radio").last().click();
  await (await openPopover(page, "Trade direction")).getByRole("radio", { name: /^Down/ }).click();
  const amounts = await openPopover(page, "Trade amount");
  await amounts.getByRole("radio", { name: "Other", exact: true }).click();
  await page.getByRole("textbox", { name: "Amount in dollars" }).fill("10000");
  await fitsHorizontally(page, amounts);
  await page.getByRole("button", { name: "Trade amount", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$10,000");
  await expect(page.getByRole("button", { name: "Add funds to buy", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel("Trade ticket").getByText("Max loss", { exact: false })).toBeInViewport({ ratio: 1 });
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 320, height: 360 });
  const date = page.getByRole("button", { name: "End date", exact: true });
  await date.click();
  await expect(date).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(date).not.toBeInViewport();
  await expect(date).toHaveAttribute("aria-expanded", "false");
});

test("Lite baseline and every popover fit the viewport and support Escape", async ({ page }) => {
  await ready(page);
  const noOverflow = async () => {
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  };
  const screenshot = (slug: string) => page.screenshot({ path: test.info().outputPath(`${test.info().project.name}-${slug}.png`), animations: "disabled" });
  await noOverflow();
  const buy = page.getByRole("button", { name: "Buy Up · $25", exact: true });
  const buyBounds = await buy.boundingBox();
  expect(buyBounds).not.toBeNull();
  expect(buyBounds!.y + buyBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await screenshot("baseline");

  for (const label of [...CHIP_LABELS, "About estimated chance"]) {
    const trigger = page.getByRole("button", { name: label, exact: true });
    const target = await trigger.boundingBox();
    expect(target).not.toBeNull();
    expect(target!.width, label).toBeGreaterThanOrEqual(44);
    expect(target!.height, label).toBeGreaterThanOrEqual(44);
    const panel = await openPopover(page, label);
    await panel.scrollIntoViewIfNeeded();
    await settle(panel);
    await fitsHorizontally(page, panel);
    await expect(panel).toBeInViewport({ ratio: 1 });
    const content = panel.locator(":scope > span");
    await expect(content).toBeVisible();
    expect.soft(await content.evaluate((el) => el.scrollWidth - el.clientWidth), label).toBeLessThanOrEqual(0);
    await noOverflow();
    await screenshot(label.toLowerCase().replaceAll(" ", "-"));
    const options = panel.getByRole("radio");
    for (const option of await options.all()) {
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport({ ratio: 1 });
    }
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  }
});

const paint = (page: Page) => page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, document.querySelector('meta[name="theme-color"]')?.getAttribute("content")]);
const DARK = ["rgb(10, 10, 10)", "#0a0a0a"];
const LIGHT = ["rgb(242, 241, 233)", "#f2f1e9"];

test("one toggle switches the landing and the app between dark and light, painted before load and kept after reload", async ({ page, isMobile }) => {
  const toggle = page.getByRole("button", { name: "Light theme" });
  await page.goto("/");
  expect(await paint(page)).toEqual(DARK);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await paint(page)).toEqual(LIGHT);
  await page.goto("/app");
  await expect(page.getByLabel("Trade sentence")).toBeVisible();
  expect(await paint(page)).toEqual(LIGHT);
  await page.reload();
  expect(await paint(page)).toEqual(LIGHT);
  await connectDemo(page);
  if (isMobile) {
    await expect(toggle).toBeHidden();
    await page.getByRole("button", { name: /^Account / }).click();
  }
  await toggle.click();
  expect(await paint(page)).toEqual(DARK);
  await page.reload();
  expect(await paint(page)).toEqual(DARK);
});

test("the price list runs high to low with now marked between the prices either side", async ({ page }) => {
  await ready(page);
  for (const side of ["Up", "Down"]) {
    await (await openPopover(page, "Trade direction")).getByRole("radio", { name: new RegExp(`^${side}`) }).click();
    const prices = await openPopover(page, "Price to beat");
    const ladder = await prices.getByRole("radiogroup", { name: "Prices to beat" }).evaluate((group) =>
      [...group.children].map((row) => ({ now: row.getAttribute("role") !== "radio", text: row.textContent ?? "" })));
    const steps = ladder.map(({ now, text }) => ({ now, price: dollars(text)[0] ?? Number.NaN }));
    const at = steps.findIndex((step) => step.now);
    expect(steps.filter((step) => step.now)).toHaveLength(1);
    const spot = steps[at]!.price;
    const strikes = steps.filter((step) => !step.now).map((step) => step.price);
    expect(strikes.length).toBeGreaterThan(2);
    expect(strikes).toEqual([...strikes].sort((a, b) => b - a));
    expect(steps.slice(0, at).every((step) => step.price >= spot)).toBe(true);
    expect(steps.slice(at + 1).every((step) => step.price < spot)).toBe(true);
    await page.keyboard.press("Escape");
  }
});

test("the buy dock pins on tall phones without covering focus or moving the page, and never covers the payout on short ones", async ({ page }) => {
  await ready(page);
  const clear = (locator: Locator) => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.top >= 0 && box.bottom <= innerHeight && hit !== null && element.contains(hit);
  });
  await page.setViewportSize({ width: 360, height: 720 });
  const buy = page.getByRole("button", { name: "Buy Up · $25", exact: true });
  for (const name of [...CHIP_LABELS, "About estimated chance"]) {
    const control = page.getByRole("button", { name, exact: true });
    await control.evaluate((element) => {
      const ticket = element.closest<HTMLElement>("section")!;
      ticket.style.paddingTop = "0px";
      window.scrollTo(0, 0);
      ticket.style.paddingTop = `${Math.max(0, innerHeight - 100 - element.getBoundingClientRect().top)}px`;
    });
    await expect.poll(() => clear(buy)).toBe(true);
    expect(await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return box.top >= 0 && box.bottom <= innerHeight && hit !== null && !element.contains(hit);
    }), `${name} sits under the dock before focus`).toBe(true);
    await control.focus();
    await expect.poll(() => clear(control), name).toBe(true);
    await control.blur();
  }
  await page.getByLabel("Trade ticket").evaluate((ticket) => { ticket.style.paddingTop = "0px"; });

  await page.evaluate(() => window.scrollTo(0, 0));
  await buy.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /^Buy for \$/ })).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(buy).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(0);

  await page.setViewportSize({ width: 360, height: 560 });
  const payout = page.getByLabel("Maximum payout");
  await payout.evaluate((element) => element.scrollIntoView({ block: "end" }));
  await expect.poll(() => clear(payout)).toBe(true);
});

test("opening a picker after scrolling keeps the page where it was", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only a phone widens its viewport for a panel that overflows");
  await ready(page);
  await page.getByLabel("Trade ticket").evaluate((ticket) => { ticket.style.paddingTop = "20rem"; });
  for (const label of [...CHIP_LABELS, "About estimated chance"]) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const before = await page.evaluate(() => scrollY);
    expect(before, label).toBeGreaterThan(0);
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-expanded", "true");
    expect(await page.evaluate(() => scrollY), label).toBe(before);
    await page.keyboard.press("Escape");
  }
});

test("pickers stay on screen with reduced motion while the ticket keeps updating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  for (const label of CHIP_LABELS) {
    const panel = await openPopover(page, label);
    for (let tick = 0; tick < 3; tick++) {
      await page.clock.runFor(1_000);
      await settle(panel);
      await fitsHorizontally(page, panel);
    }
    await page.keyboard.press("Escape");
  }
});
