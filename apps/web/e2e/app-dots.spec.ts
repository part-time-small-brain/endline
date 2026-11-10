import type { CDPSession, Locator, Page } from "@playwright/test";
import { canvasPixels, expect, handleOf, settle, test, tintOf } from "./fixtures.ts";

type Area = { x: number; y: number; width: number; height: number };

const glow = (page: Page) => page.locator("canvas[data-side]");
const wash = (page: Page) => page.locator('div[data-side][aria-hidden="true"]');
const washOpacity = (page: Page) => wash(page).evaluate((element) => Number(getComputedStyle(element).opacity));
const ready = (page: Page) => expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
const lit = async (page: Page, area: Area) => tintOf(await canvasPixels(glow(page), area.x, area.y, area.width, area.height));
const around = (x: number, y: number): Area => ({ x: x - 40, y: y - 40, width: 80, height: 80 });
const draws = async (page: Page) => Number(await glow(page).getAttribute("data-draws"));

async function brightestGreen(page: Page, area: Area) {
  const data = await canvasPixels(glow(page), area.x, area.y, area.width, area.height);
  let best = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i + 3] ?? 0) > (data[best + 3] ?? 0)) best = i;
  return data[best + 1] ?? 0;
}

async function onScreen(page: Page, area: Area) {
  const png = (await page.screenshot({ clip: area })).toString("base64");
  const data = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = `data:image/png;base64,${src}`;
    await image.decode();
    const copy = document.createElement("canvas");
    copy.width = image.width;
    copy.height = image.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
  }, png);
  return tintOf(data);
}

async function drawCounter(page: Page) {
  const canvas: Locator = glow(page);
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    element.dataset.draws = "0";
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof clear>) {
      if (this.canvas === element) element.dataset.draws = String(Number(element.dataset.draws) + 1);
      return clear.apply(this, args);
    };
  });
  return async () => {
    const before = await draws(page);
    await page.waitForTimeout(300);
    return (await draws(page)) - before;
  };
}

test("dots near the mouse glow in the picked side's colour, follow a side or theme switch, and fade only when the mouse leaves the window", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app");
  await ready(page);
  const drawsWhileWaiting = await drawCounter(page);
  const spot = around(100, 500);
  expect(await lit(page, spot)).toBe("none");

  await page.mouse.move(100, 500);
  await expect.poll(() => lit(page, spot)).toBe("up");
  await expect.poll(() => washOpacity(page)).toBeGreaterThan(0.1);
  await expect.poll(drawsWhileWaiting).toBe(0);
  expect(Math.abs((await brightestGreen(page, spot)) - 236)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Light theme" }).press("Enter");
  await expect.poll(async () => Math.abs((await brightestGreen(page, spot)) - 194)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Trade direction", exact: true }).press("Enter");
  await page.getByRole("radio", { name: /^Down/ }).press("Enter");
  await expect.poll(() => lit(page, spot)).toBe("down");

  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse", relatedTarget: document.body })));
  await page.waitForTimeout(300);
  expect(await lit(page, spot)).toBe("down");

  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse" })));
  await expect.poll(() => lit(page, spot)).toBe("none");
  await expect.poll(drawsWhileWaiting).toBe(0);
});

test("turning on reduced motion hides the wash at once and the dots still glow", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app");
  await ready(page);
  await page.mouse.move(100, 500);
  await expect.poll(() => washOpacity(page)).toBeGreaterThan(0.1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(wash(page)).toBeHidden();
  await page.mouse.move(500, 500);
  await expect.poll(() => lit(page, around(500, 500))).toBe("up");
});

test("Positions glows too", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app/positions");
  await expect(page.getByText("No wallet connected")).toBeVisible();
  await page.mouse.move(100, 500);
  await expect.poll(() => lit(page, around(100, 500))).toBe("up");
});

test("lit dots stay on the page's dot grid and redraw when the page scrolls", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto("/app");
  await ready(page);
  const drawsWhileWaiting = await drawCounter(page);
  await glow(page).evaluate((element: HTMLCanvasElement) => {
    const arc = CanvasRenderingContext2D.prototype.arc;
    const onGrid = (at: number, scrolled: number) => Math.abs(((at + scrolled) % 18) - 9) < 0.01;
    element.dataset.offGrid = "0";
    CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof arc>) {
      if (this.canvas === element && (!onGrid(args[0], scrollX) || !onGrid(args[1], scrollY))) element.dataset.offGrid = String(Number(element.dataset.offGrid) + 1);
      return arc.apply(this, args);
    };
  });
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => scrollY % 18)).toBeGreaterThan(0);
  await page.mouse.move(100, 300);
  await expect.poll(() => lit(page, around(100, 300))).toBe("up");
  await expect.poll(drawsWhileWaiting).toBe(0);

  const settled = await draws(page);
  await page.mouse.wheel(0, -40);
  await expect.poll(() => draws(page)).toBeGreaterThan(settled);
  await expect.poll(() => lit(page, around(100, 300))).toBe("up");
  await expect(glow(page)).toHaveAttribute("data-off-grid", "0");
});

test("touch leaves the app dots dark and scrolling draws nothing", async ({ page, context }) => {
  test.skip(test.info().project.use.hasTouch !== true, "touch only");
  await page.goto("/app");
  await ready(page);
  await drawCounter(page);
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 400 }] });
  for (let i = 1; i <= 4; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195 + i, y: 400 + i }] });
  await page.waitForTimeout(500);
  expect(await lit(page, { x: 0, y: 0, width: 390, height: 844 })).toBe("none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });

  const before = await draws(page);
  await page.evaluate(() => dispatchEvent(new Event("scroll")));
  await page.waitForTimeout(300);
  expect(await draws(page)).toBe(before);
});

test("the header keeps its text clear of the glow", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app");
  await ready(page);
  const header = await page.getByRole("banner").boundingBox();
  const toggle = await page.getByRole("button", { name: "Light theme" }).boundingBox();
  if (!header || !toggle) throw new Error("no header");
  const x = toggle.x - 60;
  const inHeader = { x: x - 40, y: header.y + 8, width: 80, height: header.height - 16 };
  const below = { x: x - 40, y: header.y + header.height + 20, width: 80, height: 80 };

  await page.mouse.move(x, header.y + header.height / 2);
  await expect.poll(() => lit(page, inHeader)).toBe("up");
  await expect.poll(() => onScreen(page, below)).toBe("up");
  expect(await onScreen(page, inHeader)).toBe("none");
});

test("market stats keep their text clear of the glow", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
  const timer = await page.getByRole("timer").first().boundingBox();
  if (!timer) throw new Error("no countdown");

  await page.mouse.move(timer.x + timer.width / 2, timer.y + timer.height / 2);
  await expect.poll(() => lit(page, timer)).toBe("up");
  expect(await onScreen(page, timer)).toBe("none");
});

test("market stat boxes stay below the header on phones and desktops", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
  const header = await page.getByRole("banner").boundingBox();
  const box = await page.getByRole("timer").first().locator("xpath=../..").boundingBox();
  if (!header || !box) throw new Error("no layout");
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
});
