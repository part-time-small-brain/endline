import type { CDPSession, Locator, Page } from "@playwright/test";
import { expect, money, openPopover, sideways, test } from "./fixtures.ts";

const hero = (page: Page) => page.locator("#top");
const ready = (page: Page) => expect(hero(page).getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);

async function pixels(page: Page, x: number, y: number, width: number, height: number) {
  return hero(page)
    .locator("canvas")
    .evaluate(
      (canvas: HTMLCanvasElement, area) => {
        const box = canvas.getBoundingClientRect();
        const scale = canvas.width / box.width;
        const copy = document.createElement("canvas");
        copy.width = area.width * scale;
        copy.height = area.height * scale;
        const ctx = copy.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(canvas, (area.x - box.left) * scale, (area.y - box.top) * scale, copy.width, copy.height, 0, 0, copy.width, copy.height);
        return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
      },
      { x, y, width, height },
    );
}

function tintOf(data: number[]) {
  let up = 0;
  let down = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r = 0, g = 0, , a = 0] = data.slice(i, i + 4);
    if (a > 64 && g - r > 60) up++;
    if (a > 64 && r - g > 60) down++;
  }
  return up && down ? "mixed" : up ? "up" : down ? "down" : "none";
}

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
    await expect(line.locator("span").first()).toHaveCSS("background-color", "rgb(0, 236, 151)");
    await expect(line.locator("span").last()).toHaveCSS("background-color", "rgb(255, 121, 102)");
    await expect(async () => {
      const at = await line.evaluate((bar) => {
        const box = bar.getBoundingClientRect();
        const title = (bar.closest("h1") as HTMLElement).getBoundingClientRect();
        const words = (bar.parentElement as HTMLElement).getBoundingClientRect();
        const lead = [...document.querySelectorAll("#top p")].find((p) => p.textContent?.startsWith("Choose whether"))?.getBoundingClientRect();
        return { above: box.top - title.bottom, below: (lead?.top ?? 0) - box.bottom, left: box.left - words.left };
      });
      expect(at.above, `${size?.width ?? "phone"} gap above`).toBeGreaterThanOrEqual(8);
      expect(at.below, `${size?.width ?? "phone"} gap below`).toBeGreaterThanOrEqual(24);
      expect(at.left).toBe(0);
    }).toPass({ timeout: 5000 });
  }
});

test("the hero ticket opens the same trade in the app", async ({ page }) => {
  await (await openPopover(page, "Trade asset")).getByRole("radio", { name: /^ETH/ }).click();
  await (await openPopover(page, "Trade direction")).getByRole("radio", { name: /^Down/ }).click();
  await (await openPopover(page, "Trade amount")).getByRole("radio", { name: "$100", exact: true }).click();
  await (await openPopover(page, "Price to beat")).getByRole("radio", { checked: false }).first().click();
  const strike = await money(page.getByRole("button", { name: "Price to beat", exact: true }));
  await hero(page).getByRole("link", { name: "Try ETH Down for $100" }).click();
  await expect(page).toHaveURL(/\/app\?/);
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Trade asset", exact: true })).toHaveText("ETH");
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toContainText("below");
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$100");
  await expect.poll(() => money(page.getByRole("button", { name: "Price to beat", exact: true }))).toBe(strike);
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
  const risk = hero(page).getByText("Choose whether Bitcoin or Ethereum ends above or below your price. The most you can lose is what you pay.");
  expect(await risk.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const controls = page.locator("#floor").getByRole("radiogroup", { name: "Your side" });
  await controls.scrollIntoViewIfNeeded();
  expect(await controls.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("risk info lives in one footer line and the page reads as the product", async ({ page }) => {
  expect(await page.locator("main").innerText()).not.toMatch(/testnet|mock|demo|planned|audit|example/i);
  await expect(page.locator("#safety").getByText("BTC, one recorded oracle run", { exact: true })).toBeVisible();
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("isn't audited");
  await expect(footer.getByRole("link", { name: "Safety and risks" })).toHaveAttribute("href", "/docs/safety-and-risks");
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

test("section labels and cards match the app's ticket", async ({ page }) => {
  const style = (locator: Locator, names: string[]) => locator.evaluate((element, props) => props.map((prop) => getComputedStyle(element).getPropertyValue(prop)), names);
  const LABEL = ["font-family", "font-size", "letter-spacing", "text-transform", "color"];
  const CARD = ["border-top-width", "border-top-color", "border-radius", "background-color"];
  const label = await style(hero(page).getByText("Payout", { exact: true }), LABEL);
  for (const [section, text] of [["#top", "Final price"], ["#how", "You give"], ["#floor", "Your side"], ["#safety", "Paid out"], ["#intents", "One balance"]] as const) {
    expect(await style(page.locator(section).getByText(text, { exact: true }), LABEL), text).toEqual(label);
  }
  const card = await style(hero(page).getByRole("region", { name: "Trade ticket" }).locator(":scope > div").first(), CARD);
  expect(await style(page.locator("#how").getByText("You give", { exact: true }).locator("xpath=../.."), CARD)).toEqual(card);
  expect(await style(page.locator("#safety").getByText("BTC, one recorded oracle run").locator(".."), CARD)).toEqual(card);
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
    const top = element.getBoundingClientRect().top + scrollY;
    CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof arc>) {
      if (this.canvas === element) element.dataset.offGrid = String(Number(element.dataset.offGrid ?? 0) + ((args[1] + top) % 18 === 9 ? 0 : 1));
      return arc.apply(this, args);
    };
  });
  await page.mouse.move(40, 320);
  await expect.poll(() => tints(page, 40, 320)).toEqual({ above: "up", below: "down" });
  expect(await cursorLineOpacity(page)).toBe(0);
  await expect(canvas).toHaveAttribute("data-off-grid", "0");
});
