import type { CDPSession, Page } from "@playwright/test";
import { canvasPixels, expect, handleOf, money, openPopover, sideways, test, tintOf } from "./fixtures.ts";

const hero = (page: Page) => page.getByRole("region", { name: "Pick a side of the line." });
const ready = (page: Page) => expect(hero(page).getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);

const pixels = (page: Page, x: number, y: number, width: number, height: number) => canvasPixels(hero(page).locator("canvas"), x, y, width, height);

async function tints(page: Page, x: number, y: number) {
  return { above: tintOf(await pixels(page, x - 30, y - 30, 60, 24)), below: tintOf(await pixels(page, x - 30, y + 6, 60, 24)) };
}

const cursorLineOpacity = (page: Page) => hero(page).locator("canvas + div").evaluate((line) => Number(getComputedStyle(line).opacity));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await ready(page);
});

test("the split line sits under the headline words, clear of the title and the copy below", async ({ page }) => {
  const sizes = test.info().project.use.isMobile === true ? [undefined] : [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }];
  for (const size of sizes) {
    if (size) {
      await page.setViewportSize(size);
      await page.reload();
      await ready(page);
    }
    const line = hero(page).locator("h1 span[aria-hidden=true]");
    await expect(async () => {
      const at = await line.evaluate((bar) => {
        const box = bar.getBoundingClientRect();
        const title = (bar.closest("h1") as HTMLElement).getBoundingClientRect();
        const lead = [...(bar.closest("section") as HTMLElement).querySelectorAll("p")].find((p) => p.textContent?.startsWith("Choose whether"))?.getBoundingClientRect();
        return { above: box.top - title.bottom, below: (lead?.top ?? 0) - box.bottom };
      });
      expect(at.above, `${size?.width ?? "phone"} gap above`).toBeGreaterThanOrEqual(8);
      expect(at.below, `${size?.width ?? "phone"} gap below`).toBeGreaterThanOrEqual(24);
    }).toPass({ timeout: 5000 });
  }
});

test("the hero ticket opens the same trade in the app", async ({ page }) => {
  await (await openPopover(page, "Trade direction")).getByRole("radio", { name: /^Down/ }).click();
  await (await openPopover(page, "Trade amount")).getByRole("radio", { name: "$100", exact: true }).click();
  await (await openPopover(page, "Price to beat")).getByRole("radio", { checked: false }).first().click();
  const strike = await money(page.getByRole("button", { name: "Price to beat", exact: true }));
  await hero(page).getByRole("link", { name: "Try BTC Down for $100" }).click();
  await expect(page).toHaveURL(/\/app\?/);
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toContainText("below");
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$100");
  await expect.poll(() => money(page.getByRole("button", { name: "Price to beat", exact: true }))).toBe(strike);
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: /^Down/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "$100", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(handleOf(page)).toHaveAttribute("aria-valuenow", String(strike));
});

test("an invalid amount in the hero ticket disables its button instead of dropping the trade", async ({ page }) => {
  await (await openPopover(page, "Trade amount")).getByRole("radio", { name: "Other" }).click();
  await page.getByLabel("Amount in dollars").fill("0.5");
  await expect(hero(page).getByRole("button", { name: "Enter a valid amount" })).toBeDisabled();
  await expect(page.locator('a[href*="series="]')).toHaveCount(0);
});

test("on a phone the ticket's buy bar sits under the card instead of over it", async ({ page }) => {
  test.skip(test.info().project.use.isMobile !== true, "phones only");
  const parts = hero(page).getByRole("region", { name: "Trade ticket" }).locator(":scope > div");
  const card = await parts.first().boundingBox();
  const bar = await parts.last().boundingBox();
  expect(card && bar && bar.y - (card.y + card.height)).toBeGreaterThanOrEqual(0);
});

test("the headline reads as words and the wordmark goes back to the very top", async ({ page }) => {
  await expect(hero(page).getByRole("heading", { level: 1 })).toHaveAccessibleName("Pick a side of the line.");
  await page.evaluate(() => scrollTo(0, 30));
  await page.getByRole("link", { name: "Endline, back to top" }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("whole page scrolls without horizontal overflow and every section shows up", async ({ page }) => {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(80);
  }
  await expect.poll(() => sideways(page)).toBeLessThanOrEqual(0);
  for (const heading of await page.getByRole("heading", { level: 2 }).all()) {
    await heading.scrollIntoViewIfNeeded();
    await expect.poll(() => heading.evaluate((h) => Number(getComputedStyle(h.closest("[style*=opacity]") ?? h).opacity))).toBeGreaterThan(0.95);
  }
});

test("the 320px landing keeps risk copy and payout controls inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await ready(page);
  await expect.poll(() => sideways(page)).toBeLessThanOrEqual(0);
  const risk = hero(page).getByText("Choose whether the price ends above or below your line. See your payout before you sign.");
  expect(await risk.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const controls = page.locator("#floor").getByRole("radiogroup", { name: "Your side" });
  await controls.scrollIntoViewIfNeeded();
  expect(await controls.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("the page reads as the product", async ({ page }) => {
  expect(await page.locator("body").innerText()).not.toMatch(/testnet|mock|demo|planned|audit|example/i);
  await expect(page.locator("#safety").getByText("BTC, one recorded oracle run", { exact: true })).toBeVisible();
});

test("the header matches the app header and scrolls away with the page", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "the app header adds a tab row on phones");
  const bar = (at: Page) => at.getByRole("banner").evaluate((header) => {
    const style = getComputedStyle(header);
    const box = header.getBoundingClientRect();
    return { top: box.top, height: box.height, rule: `${style.borderBottomWidth} ${style.borderBottomColor}` };
  });
  const landing = await bar(page);
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await bar(page)).top).toBeLessThan(-landing.height);
  await page.goto("/app");
  expect(await bar(page)).toEqual(landing);
});

test("every funding chain shows a loaded logo", async ({ page }) => {
  const chains = page.locator("#intents li").filter({ hasText: /^(Bitcoin|Ethereum|Base|Arbitrum|Solana|NEAR)$/ });
  await expect(chains).toHaveCount(6);
  await chains.first().scrollIntoViewIfNeeded();
  for (const chain of await chains.all()) {
    await expect.poll(() => chain.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  }
});

test("hero dots split Up and Down around the cursor, fade when it leaves, then idle", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  const canvas = hero(page).locator("canvas");
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    element.dataset.draws = "0";
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof clear>) {
      if (this.canvas === element) element.dataset.draws = String(Number(element.dataset.draws) + 1);
      return clear.apply(this, args);
    };
  });
  const drawsWhileWaiting = async () => {
    const before = Number(await canvas.getAttribute("data-draws"));
    await page.waitForTimeout(300);
    return Number(await canvas.getAttribute("data-draws")) - before;
  };
  const spot = { x: 40, y: 320 };
  expect(await tints(page, spot.x, spot.y)).toEqual({ above: "none", below: "none" });
  await page.mouse.move(spot.x, spot.y);
  await expect.poll(() => tints(page, spot.x, spot.y)).toEqual({ above: "up", below: "down" });
  await expect(canvas).not.toHaveAttribute("data-draws", "0");
  await expect.poll(() => cursorLineOpacity(page)).toBeGreaterThan(0.8);
  const line = await hero(page).locator("canvas + div").boundingBox();
  expect(line && [line.x + line.width / 2, line.y + line.height / 2]).toEqual([spot.x, spot.y]);
  await expect.poll(drawsWhileWaiting).toBe(0);

  const nav = page.getByRole("navigation", { name: "Main" });
  const box = await nav.boundingBox();
  if (!box) throw new Error("no nav");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => tints(page, spot.x, spot.y)).toEqual({ above: "none", below: "none" });
  await expect.poll(() => cursorLineOpacity(page)).toBeLessThan(0.01);
  await expect.poll(drawsWhileWaiting).toBe(0);
});

test("touch leaves the hero dots alone", async ({ page, context }) => {
  test.skip(test.info().project.use.hasTouch !== true, "touch only");
  const box = await hero(page).locator("h1").boundingBox();
  if (!box) throw new Error("no title");
  const cdp: CDPSession = await context.newCDPSession(page);
  const x = box.x + 40;
  const y = box.y + box.height;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 12 }] });
  await page.waitForTimeout(500);
  expect(tintOf(await pixels(page, x - 150, y - 270, 300, 300))).toBe("none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
});

test("with reduced motion the hero dots still color but stay on the page's dot grid and the cursor line stays hidden", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await ready(page);
  const canvas = hero(page).locator("canvas");
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const arc = CanvasRenderingContext2D.prototype.arc;
    const box = element.getBoundingClientRect();
    const onGrid = (at: number, edge: number) => (at + edge) % 18 === 9;
    CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof arc>) {
      if (this.canvas === element) element.dataset.offGrid = String(Number(element.dataset.offGrid ?? 0) + (onGrid(args[0], box.left + scrollX) && onGrid(args[1], box.top + scrollY) ? 0 : 1));
      return arc.apply(this, args);
    };
  });
  await page.mouse.move(40, 320);
  await expect.poll(() => tints(page, 40, 320)).toEqual({ above: "up", below: "down" });
  expect(await cursorLineOpacity(page)).toBe(0);
  await expect(canvas).toHaveAttribute("data-off-grid", "0");
});

test("the floor demo plays where the price ends until a visitor drags it", async ({ page }) => {
  const slider = page.locator("#floor").getByRole("slider");
  await slider.scrollIntoViewIfNeeded();
  const first = await slider.getAttribute("aria-valuenow");
  await expect.poll(() => slider.getAttribute("aria-valuenow")).not.toBe(first);
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  const held = await slider.getAttribute("aria-valuenow");
  await page.waitForTimeout(600);
  expect(await slider.getAttribute("aria-valuenow")).toBe(held);
});

test("with reduced motion the floor demo holds still on a price that pays", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await ready(page);
  const floor = page.locator("#floor");
  await floor.getByRole("slider").scrollIntoViewIfNeeded();
  const held = await floor.getByRole("slider").getAttribute("aria-valuenow");
  await page.waitForTimeout(600);
  expect(await floor.getByRole("slider").getAttribute("aria-valuenow")).toBe(held);
  await expect(floor.getByText(/^Result /)).toHaveText(/^Result \+\$/);
});
