import type { CDPSession, Locator, Page } from "@playwright/test";
import { canvasPixels, connectDemo, expect, handleOf, settle, test, tintOf } from "./fixtures.ts";

type Area = { x: number; y: number; width: number; height: number };

const glow = (page: Page) => page.locator("canvas[data-side]");
const ready = (page: Page) => expect(page.getByLabel("Maximum payout")).toHaveText(/^\$[\d,.]+$/);
const lit = async (page: Page, area: Area) => tintOf(await canvasPixels(glow(page), area.x, area.y, area.width, area.height));
const around = (x: number, y: number): Area => ({ x: x - 40, y: y - 40, width: 80, height: 80 });

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

async function covered(trigger: Locator) {
  await trigger.click();
  const panel = trigger.locator("..").locator(":scope > span");
  await expect(panel).toBeVisible();
  return panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let hidden = 0;
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        const hit = document.elementFromPoint(box.left + (box.width * i) / 8, box.top + (box.height * j) / 8);
        if (!hit || !element.contains(hit)) hidden++;
      }
    }
    return hidden;
  });
}

async function drawCounter(canvas: Locator) {
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    element.dataset.draws = "0";
    CanvasRenderingContext2D.prototype.clearRect = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof clear>) {
      if (this.canvas === element) element.dataset.draws = String(Number(element.dataset.draws) + 1);
      return clear.apply(this, args);
    };
  });
  return async () => {
    const before = Number(await canvas.getAttribute("data-draws"));
    await canvas.page().waitForTimeout(300);
    return Number(await canvas.getAttribute("data-draws")) - before;
  };
}

test("dots near the mouse glow in the picked side's colour, follow a side switch, and fade when the mouse leaves the window", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app");
  await ready(page);
  const drawsWhileWaiting = await drawCounter(glow(page));
  const spot = around(100, 500);
  expect(await lit(page, spot)).toBe("none");

  await page.mouse.move(100, 500);
  await expect.poll(() => lit(page, spot)).toBe("up");
  await expect.poll(drawsWhileWaiting).toBe(0);

  await page.getByRole("button", { name: "Trade direction", exact: true }).press("Enter");
  await page.getByRole("radio", { name: /^Down/ }).press("Enter");
  await expect.poll(() => lit(page, spot)).toBe("down");

  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerout", { pointerType: "mouse" })));
  await expect.poll(() => lit(page, spot)).toBe("none");
  await expect.poll(drawsWhileWaiting).toBe(0);
});

test("Positions glows too", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app/positions");
  await expect(page.getByText("No wallet connected")).toBeVisible();
  await page.mouse.move(100, 500);
  await expect.poll(() => lit(page, around(100, 500))).toBe("up");
});

test("lit dots stay on the page's dot grid when the page scrolls", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto("/app");
  await ready(page);
  await glow(page).evaluate((element: HTMLCanvasElement) => {
    const arc = CanvasRenderingContext2D.prototype.arc;
    const onGrid = (at: number, scrolled: number) => Math.abs(((at + scrolled) % 18) - 9) < 0.01;
    element.dataset.dots = "0";
    element.dataset.offGrid = "0";
    CanvasRenderingContext2D.prototype.arc = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof arc>) {
      if (this.canvas === element) {
        element.dataset.dots = String(Number(element.dataset.dots) + 1);
        if (!onGrid(args[0], scrollX) || !onGrid(args[1], scrollY)) element.dataset.offGrid = String(Number(element.dataset.offGrid) + 1);
      }
      return arc.apply(this, args);
    };
  });
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => scrollY % 18)).toBeGreaterThan(0);
  await page.mouse.move(100, 300);
  await expect.poll(() => lit(page, around(100, 300))).toBe("up");
  const dots = async () => Number(await glow(page).getAttribute("data-dots"));
  const drawnWhileWaiting = async () => {
    const before = await dots();
    await page.waitForTimeout(300);
    return (await dots()) - before;
  };
  await expect.poll(drawnWhileWaiting).toBe(0);
  const settled = await dots();
  await page.mouse.wheel(0, -40);
  await expect.poll(dots).toBeGreaterThan(settled);
  await expect.poll(() => lit(page, around(100, 300))).toBe("up");
  await expect(glow(page)).toHaveAttribute("data-off-grid", "0");
});

test("touch leaves the app dots dark", async ({ page, context }) => {
  test.skip(test.info().project.use.hasTouch !== true, "touch only");
  await page.goto("/app");
  await ready(page);
  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 400 }] });
  for (let i = 1; i <= 4; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195 + i, y: 400 + i }] });
  await page.waitForTimeout(500);
  expect(await lit(page, { x: 0, y: 0, width: 390, height: 844 })).toBe("none");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
});

test("the header keeps its text clear of the glow, and its account menu opens over the order panel", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.goto("/app");
  await ready(page);
  const header = await page.getByRole("banner").boundingBox();
  const toggle = await page.getByRole("button", { name: "Light theme" }).boundingBox();
  const sentence = await page.getByLabel("Trade sentence").boundingBox();
  if (!header || !toggle || !sentence) throw new Error("no layout");
  const x = toggle.x - 60;
  expect(x - 40).toBeGreaterThan(sentence.x + sentence.width + 40);
  const inHeader = { x: x - 40, y: header.y + 8, width: 80, height: header.height - 16 };
  const below = { x: x - 40, y: header.y + header.height + 20, width: 80, height: 80 };

  await page.mouse.move(x, header.y + header.height / 2);
  await expect.poll(() => lit(page, inHeader)).toBe("up");
  await expect.poll(() => onScreen(page, below)).toBe("up");
  expect(await onScreen(page, inHeader)).toBe("none");

  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await connectDemo(page);
  expect(await covered(page.getByRole("button", { name: /^Account / }))).toBe(0);
});

test("market stats keep their text clear of the glow, and their settlement note opens over the chart", async ({ page }) => {
  test.skip(test.info().project.use.isMobile === true, "needs a hovering pointer");
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
  const timer = await page.getByRole("timer").first().boundingBox();
  if (!timer) throw new Error("no countdown");

  await page.mouse.move(timer.x + timer.width / 2, timer.y + timer.height / 2);
  await expect.poll(() => lit(page, timer)).toBe("up");
  expect(await onScreen(page, timer)).toBe("none");

  expect(await covered(page.getByRole("button", { name: "How the final price is set" }))).toBe(0);
});
