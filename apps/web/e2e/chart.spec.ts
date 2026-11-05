import type { CDPSession, Page } from "@playwright/test";
import { chartOf, dollars, expect, futureX, geometry, handleOf, mid, money, overlaps, pointAt, scaleOf, settle, term, test, tip, tooltipOf, valueOf } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
});

async function dragTo(page: Page, y: number, wiggles = 0) {
  const handle = handleOf(page);
  await settle(handle);
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  for (let i = 0; i < wiggles; i++) await page.mouse.move(x + (i % 2 ? 3 : -3), y, { steps: 2 });
  await page.mouse.up();
}

const side = (page: Page, name: "Up" | "Down") => page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: new RegExp(`^${name}`) });
const asset = (page: Page, name: string) => page.getByRole("radio", { name: new RegExp(`^${name}\\b`) });

test("handle, line and y-axis agree at every strike, with no label collisions", async ({ page }) => {
  for (const name of ["Up", "Down"] as const) {
    await side(page, name).click();
    const handle = handleOf(page);
    await handle.focus();
    await page.keyboard.press("Home");
    const max = Number(await handle.getAttribute("aria-valuemax"));
    for (;;) {
      await settle(handle);
      const value = await valueOf(handle);
      await expect(async () => {
        const chart = await geometry(page);
        expect(Math.abs(mid(chart.handle) - scaleOf(chart).yAt(value))).toBeLessThan(1);
        expect(Math.abs(chart.line - mid(chart.handle))).toBeLessThan(1);
        expect(overlaps(chart)).toEqual([]);
      }).toPass();
      await expect.poll(() => money(page.locator("output strong"))).toBe(value);
      if (value === max) break;
      await page.keyboard.press("ArrowUp");
      await expect(handle).not.toHaveAttribute("aria-valuenow", String(value));
    }
  }
});

test("line lands on the price to beat when lazy modules arrive late", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  let loaded = false;
  page.on("load", () => {
    loaded = true;
  });
  await page.route("**/*", async (route) => {
    if (loaded) await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await page.goto("/app");
  const handle = handleOf(page);
  await settle(handle);
  await page.waitForTimeout(1500);
  const value = await valueOf(handle);
  const chart = await geometry(page);
  expect(Math.abs(mid(chart.handle) - scaleOf(chart).yAt(value))).toBeLessThan(1);
  expect(Math.abs(chart.line - mid(chart.handle))).toBeLessThan(1);
});

test("under the NEAR look the two sides fade away from the line in either theme", async ({ page }) => {
  const opacities = (theme: string) =>
    chartOf(page).evaluate((root, t) => {
      document.documentElement.dataset.theme = t;
      return [...root.querySelectorAll("svg linearGradient")].map((g) => [...g.querySelectorAll("stop")].map((s) => getComputedStyle(s).stopOpacity));
    }, theme);
  expect(await opacities("light")).toEqual([
    ["0", "1"],
    ["1", "0"],
  ]);
  expect(await opacities("dark")).toEqual([
    ["0", "1"],
    ["1", "0"],
  ]);
});

test("dragging past an edge reaches the last strike", async ({ page }) => {
  const box = await chartOf(page).boundingBox();
  if (!box) throw new Error("no chart");
  for (const name of ["Up", "Down"] as const) {
    await side(page, name).click();
    const handle = handleOf(page);
    await dragTo(page, box.y - 40, 6);
    await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemax")) ?? "");
    await dragTo(page, Math.min(box.y + box.height + 40, (page.viewportSize()?.height ?? 0) - 1), 6);
    await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemin")) ?? "");
  }
});

test("only the primary button drags", async ({ page }) => {
  const handle = handleOf(page);
  const before = await valueOf(handle);
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + box.width / 2, box.y - 200, { steps: 6 });
  await page.mouse.up({ button: "right" });
  expect(await valueOf(handle)).toBe(before);
});

test("releasing outside the chart ends the drag", async ({ page }) => {
  const box = await chartOf(page).boundingBox();
  if (!box) throw new Error("no chart");
  await dragTo(page, box.y - 60);
  const handle = handleOf(page);
  const after = await valueOf(handle);
  await page.mouse.move(await futureX(page), box.y + box.height / 2, { steps: 6 });
  expect(await valueOf(handle)).toBe(after);
  await expect(tooltipOf(page)).toBeVisible();
});

test("handle and line stay together mid-drag", async ({ page }) => {
  await chartOf(page).evaluate((root) => {
    const slider = root.querySelector("[role=slider]") as HTMLElement;
    const line = [...root.querySelectorAll("svg > line")].find((l) => l.getAttribute("x1") === "0") as SVGLineElement;
    const gaps: number[] = [];
    Object.assign(window, { gaps });
    const sample = () => {
      const h = slider.getBoundingClientRect();
      const l = line.getBoundingClientRect();
      gaps.push(Math.abs(h.top + h.height / 2 - (l.top + l.height / 2)));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const box = await handleOf(page).boundingBox();
  if (!box) throw new Error("no handle");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i < 30; i++) await page.mouse.move(x, y - 160 + 320 * Math.abs(Math.sin(i / 5)));
  await page.mouse.up();
  const gaps = await page.evaluate(() => (window as unknown as { gaps: number[] }).gaps);
  expect(gaps.length).toBeGreaterThan(20);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(2);
});

test("tooltip follows the pointer after the scale or asset changes", async ({ page }) => {
  const touch = test.info().project.use.hasTouch === true;
  const x = await futureX(page);
  const chart = await geometry(page);
  const y = chart.top + (chart.bottom - chart.top) * 0.3;
  const expectAtPointer = async () => {
    await settle(handleOf(page));
    const scale = scaleOf(await geometry(page));
    await expect.poll(async () => Math.abs((await tip(page)).price - scale.priceAt(y)) / scale.dollarsPerPx).toBeLessThan(3);
  };
  await pointAt(page, x, y, touch);
  await expectAtPointer();
  await handleOf(page).focus();
  await page.keyboard.press("End");
  await expectAtPointer();
  if (touch) await asset(page, "ETH").tap();
  else {
    await asset(page, "ETH").focus();
    await page.keyboard.press("Space");
  }
  await expect(asset(page, "ETH")).toHaveAttribute("aria-checked", "true");
  await expectAtPointer();
});

test("tooltip agrees with the ticket and lib/payoff, and stays flat past the cap", async ({ page }) => {
  const touch = test.info().project.use.hasTouch === true;
  const x = await futureX(page);
  const strike = await valueOf(handleOf(page));
  await expect(async () => {
    const maxLoss = await money(term(page, "Max loss"));
    const breakeven = Number((await term(page, "Breakeven").textContent())?.replace(/[$,]/g, ""));
    const [cap = NaN] = dollars((await page.locator("dt", { hasText: /^If BTC ends above / }).textContent()) ?? "");
    const max = await money(term(page, /^If BTC ends above /));
    const scale = scaleOf(await geometry(page));
    await pointAt(page, x, scale.yAt(breakeven), touch);
    const atBreakeven = await tip(page);
    await pointAt(page, x, scale.yAt((breakeven + cap) / 2), touch);
    const inside = await tip(page);
    await pointAt(page, x, scale.yAt(cap + 4 * scale.dollarsPerPx), touch);
    const past = await tip(page);
    const perDollar = maxLoss / (breakeven - strike);
    expect(Math.abs(atBreakeven.price - breakeven)).toBeLessThan(scale.dollarsPerPx * 1.5);
    expect(Math.abs(atBreakeven.payout - maxLoss)).toBeLessThan(perDollar * scale.dollarsPerPx * 1.5 + 0.01);
    expect(Math.abs(inside.payout / (perDollar * (inside.price - strike)) - 1)).toBeLessThan(0.01);
    expect(past.price).toBeGreaterThan(cap);
    expect(past.payout).toBe(max);
  }).toPass({ timeout: 15_000 });

  const scale = scaleOf(await geometry(page));
  await pointAt(page, x, scale.yAt(strike) + 40, touch);
  await expect(tooltipOf(page)).toHaveText(/→ \$0$/);
});

test("payout bars are labelled", async ({ page }) => {
  const chart = await geometry(page);
  const payout = chart.labels.find((l) => l.text === "Payout");
  const end = chart.labels.find((l) => l.text === "End");
  expect(payout).toBeDefined();
  expect(end).toBeDefined();
  if (!payout || !end) return;
  expect(payout.box.left).toBeGreaterThan(end.box.right);
  expect(payout.box.right).toBeLessThan(chart.handle.left);
  expect(mid(payout.box)).toBeCloseTo(mid(end.box), 0);
});

test("drag hint sits on the line next to the handle, once", async ({ page }) => {
  for (const name of ["Up", "Down"] as const) {
    await side(page, name).click();
    await settle(handleOf(page));
    const chart = await geometry(page);
    const hint = chart.labels.find((l) => l.text === "Drag");
    expect(hint).toBeDefined();
    if (!hint) return;
    expect(mid(hint.box)).toBeCloseTo(mid(chart.handle), 0);
    expect(hint.box.right).toBeLessThanOrEqual(chart.handle.left);
    expect(chart.handle.left - hint.box.right).toBeLessThanOrEqual(12);
  }
  const box = await chartOf(page).boundingBox();
  if (!box) throw new Error("no chart");
  await dragTo(page, box.y + box.height / 3);
  await expect(chartOf(page).getByText("Drag", { exact: true })).toHaveCSS("opacity", "0");
  await page.reload();
  await settle(handleOf(page));
  await expect(chartOf(page).getByText("Drag", { exact: true })).toHaveCount(0);
});

test("switching asset, side or date after a drag lands on the Balanced strike", async ({ page }) => {
  const box = await chartOf(page).boundingBox();
  if (!box) throw new Error("no chart");
  const balanced = page.getByRole("radio", { name: /^Balanced/ });
  const switches = [() => side(page, "Down").click(), () => asset(page, "ETH").click(), () => page.getByRole("radiogroup", { name: "Ends" }).getByRole("radio").nth(2).click()];
  for (const change of switches) {
    await dragTo(page, box.y + 10);
    await change();
    await expect(balanced).toHaveAttribute("aria-checked", "true");
    const handle = handleOf(page);
    expect(await valueOf(handle)).toBe(await money(balanced));
    await expect.poll(() => money(page.locator("output strong"))).toBe(await valueOf(handle));
  }
});

test("keyboard steps clamp at both ends", async ({ page }) => {
  const handle = handleOf(page);
  await handle.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("PageUp");
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemax")) ?? "");
  await expect(page.getByRole("button", { name: "Higher price to beat" })).toBeDisabled();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await expect(handle).toHaveAttribute("aria-valuenow", (await handle.getAttribute("aria-valuemin")) ?? "");
  await expect(page.getByRole("button", { name: "Lower price to beat" })).toBeDisabled();
});

test("touch drag moves the line without scrolling the page", async ({ page, context }) => {
  test.skip(test.info().project.use.hasTouch !== true, "touch only");
  const handle = handleOf(page);
  const box = await handle.boundingBox();
  if (!box) throw new Error("no handle");
  const before = await valueOf(handle);
  const cdp: CDPSession = await context.newCDPSession(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 12 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await valueOf(handle)).toBeGreaterThan(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
