import type { CDPSession, Page } from "@playwright/test";
import { expect, handleOf, money, settle, sideways, test, valueOf } from "./fixtures.ts";

const hero = (page: Page) => page.locator("#top");

async function horizon(page: Page) {
  return hero(page).evaluate((section) => {
    const band = section.querySelector(":scope > div.absolute.top-0.h-full") as HTMLElement;
    const slider = section.querySelector("[role=slider]") as HTMLElement;
    const handle = slider.getBoundingClientRect();
    const title = (section.querySelector("h1") as HTMLElement).getBoundingClientRect();
    return { band: band.getBoundingClientRect().top, handle: handle.top + handle.height / 2, titleBottom: title.bottom, titleHeight: title.height };
  });
}

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
  await settle(handleOf(page));
});

test("page horizon follows the hero line while dragging and on Down", async ({ page }) => {
  const handle = handleOf(page);
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  for (const y of [box.y - 60, box.y + 90, box.y - 20]) {
    await page.mouse.move(x, y, { steps: 6 });
    await settle(handle);
    await settle(hero(page).locator(":scope > div.absolute.top-0.h-full"));
    const at = await horizon(page);
    expect(Math.abs(at.band - at.handle)).toBeLessThan(1.5);
  }
  await page.mouse.up();
  await hero(page).getByRole("radio", { name: /^Down/ }).click();
  await expect(hero(page)).toHaveAttribute("data-side", "down");
  await settle(hero(page).locator(":scope > div.absolute.top-0.h-full"));
  const at = await horizon(page);
  expect(Math.abs(at.band - at.handle)).toBeLessThan(1.5);
});

for (const width of [null, 800]) {
  test(`page horizon stays on the hero line at the edge strikes, ${width ? `${width}px` : "default"} viewport`, async ({ page }) => {
    test.skip(test.info().project.use.isMobile === true && width !== null, "desktop layouts only");
    if (width) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
    }
    const handle = handleOf(page);
    await settle(handle);
    for (const name of ["Up", "Down"]) {
      await hero(page).getByRole("radio", { name: new RegExp(`^${name}`) }).click();
      await handle.focus();
      for (const key of ["End", "ArrowDown", "Home", "ArrowUp"]) {
        await page.keyboard.press(key);
        await expect(async () => {
          await settle(handle);
          await settle(hero(page).locator(":scope > div.absolute.top-0.h-full"));
          const at = await horizon(page);
          expect(Math.abs(at.band - at.handle)).toBeLessThan(1.5);
        }).toPass({ timeout: 5000 });
      }
    }
  });
}

test("title sits on the horizon", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "side-by-side hero only");
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768]] as const) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await settle(handleOf(page));
    const lineHeight = Number.parseFloat(await hero(page).locator("h1").evaluate((h1) => getComputedStyle(h1).lineHeight));
    expect((await horizon(page)).titleHeight).toBeLessThanOrEqual(lineHeight * 2 + 1);
    await expect.poll(async () => {
      const at = await horizon(page);
      return Math.abs(at.titleBottom - 8 - at.band);
    }).toBeLessThan(2);
  }
});

test("hero CTA opens the same trade", async ({ page }) => {
  await hero(page).getByRole("radio", { name: "ETH" }).click();
  await hero(page).getByRole("radio", { name: /^Down/ }).click();
  await hero(page).getByRole("radio", { name: "$100", exact: true }).click();
  const handle = handleOf(page);
  await settle(handle);
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  const strike = await valueOf(handle);
  const cta = hero(page).getByRole("link", { name: "Try ETH Down for $100" });
  await cta.click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("button", { name: "Lite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Trade asset", exact: true })).toHaveText("ETH");
  await expect(page.getByRole("button", { name: "Trade direction", exact: true })).toContainText("below");
  await expect(page.getByRole("button", { name: "Trade amount", exact: true })).toHaveText("$100");
  await expect.poll(() => money(page.getByRole("button", { name: "Price to beat", exact: true }))).toBe(strike);
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("radio", { name: /^ETH\b/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: /^Down/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "$100", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(handleOf(page)).toHaveAttribute("aria-valuenow", String(strike));
  await expect.poll(() => money(page.locator("output strong"))).toBe(strike);
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
  await settle(handleOf(page));
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

test("every funding chain shows a loaded logo", async ({ page }) => {
  const chains = page.locator("#intents li").filter({ hasText: /^(Bitcoin|Ethereum|Base|Arbitrum|Solana|NEAR)$/ });
  await expect(chains).toHaveCount(6);
  await chains.first().scrollIntoViewIfNeeded();
  for (const chain of await chains.all()) {
    await expect.poll(() => chain.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  }
});

test("hero dots split Up and Down around the cursor, fade when it leaves, then idle and follow the theme", async ({ page }) => {
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
  await expect.poll(() => cursorLineOpacity(page)).toBeGreaterThan(0.8);
  await expect.poll(drawsWhileWaiting).toBe(0);

  const nav = page.getByRole("navigation", { name: "Main" });
  const box = await nav.boundingBox();
  if (!box) throw new Error("no nav");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => tints(page, spot.x, spot.y)).toEqual({ above: "none", below: "none" });
  await expect.poll(() => cursorLineOpacity(page)).toBeLessThan(0.01);
  await expect.poll(drawsWhileWaiting).toBe(0);

  const dark = test.info().project.use.colorScheme === "dark";
  const corner = await canvas.boundingBox();
  if (!corner) throw new Error("no canvas");
  const whiteDots = async () => {
    const data = await pixels(page, corner.x, corner.y, 18, 18);
    let solidest = 0;
    for (let i = 4; i < data.length; i += 4) if ((data[i + 3] ?? 0) > (data[solidest + 3] ?? 0)) solidest = i;
    return (data[solidest] ?? 0) > 128;
  };
  expect(await whiteDots()).toBe(dark);
  await nav.getByTitle(dark ? "Light" : "Dark").click();
  await expect.poll(whiteDots).toBe(!dark);
});

test("touch leaves the hero dots alone", async ({ page, context }) => {
  test.skip(test.info().project.use.hasTouch !== true, "touch only");
  const box = await handleOf(page).boundingBox();
  if (!box) throw new Error("no handle");
  const cdp: CDPSession = await context.newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 12 }] });
  await page.waitForTimeout(500);
  expect(tintOf(await pixels(page, x - 150, y - 270, 300, 300))).toBe("none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
});

test("with reduced motion the hero dots still color but the cursor line stays hidden", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await settle(handleOf(page));
  await page.mouse.move(40, 320);
  await expect.poll(() => tints(page, 40, 320)).toEqual({ above: "up", below: "down" });
  expect(await cursorLineOpacity(page)).toBe(0);
});
