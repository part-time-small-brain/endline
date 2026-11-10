import { test as base, expect, type Locator, type Page } from "@playwright/test";
import testnet from "../../../deploy/testnet.json" with { type: "json" };

const SEED = 4;
const NOW = process.env.E2E_NOW ?? "2026-11-04T12:00:00Z";
const IGNORED = [/Reduced Motion enabled/];
export const RPC = `${testnet.rpc_url}/**`;

function seedRandom(seed: number) {
  let state = seed;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if ((message.type() === "error" || message.type() === "warning") && !IGNORED.some((pattern) => pattern.test(message.text()))) errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(seedRandom, SEED);
    await page.clock.install({ time: NOW });
    await page.route(RPC, (route) => route.abort());
    await use(page);
    expect(errors).toEqual([]);
  },
});

export { expect };

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Chart {
  top: number;
  bottom: number;
  handle: Box;
  line: number;
  ticks: [number, number][];
  labels: { text: string; box: Box }[];
}

export const handleOf = (page: Page) => page.getByRole("slider", { name: "Price to beat" }).first();
export const chartOf = (page: Page) => page.getByRole("img", { name: /over the last 24 hours/ }).first().locator("..");
export const tooltipOf = (page: Page) => chartOf(page).locator(":scope > div", { hasText: "→" });
export const term = (scope: Page | Locator, label: string | RegExp) => scope.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]").first();
export const valueOf = async (handle: Locator) => Number(await handle.getAttribute("aria-valuenow"));
export const mid = (box: Box) => (box.top + box.bottom) / 2;

export async function settle(locator: Locator) {
  let last = "";
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const now = box ? `${Math.round(box.x * 2)},${Math.round(box.y * 2)}` : "none";
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [120] })
    .toBe(true);
}

export async function geometry(page: Page): Promise<Chart> {
  return chartOf(page).evaluate((root) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const svg = root.querySelector("svg") as SVGSVGElement;
    const slider = root.querySelector("[role=slider]") as HTMLElement;
    const line = [...svg.querySelectorAll(":scope > line")].find((l) => l.getAttribute("x1") === "0") as SVGLineElement;
    const lineBox = box(line);
    const visible = (e: Element) => Number(getComputedStyle(e).opacity) > 0.1 && e.getBoundingClientRect().width > 0;
    const spans = [...root.querySelectorAll("span")].filter((e) => !slider.contains(e) && e.textContent?.trim() && visible(e) && !e.parentElement?.closest("span"));
    const ticks = spans
      .filter((e) => e.parentElement === root && /^\$[\d,.]+$/.test(e.textContent ?? "") && e.getBoundingClientRect().left >= slider.getBoundingClientRect().left)
      .map((e) => [Number(e.textContent?.replace(/[$,]/g, "")), mid(box(e))] as [number, number]);
    function mid(b: { top: number; bottom: number }) {
      return (b.top + b.bottom) / 2;
    }
    return {
      top: box(svg).top,
      bottom: box(svg).bottom,
      handle: box(slider),
      line: (lineBox.top + lineBox.bottom) / 2,
      ticks,
      labels: [{ text: "handle", box: box(slider) }, ...spans.map((e) => ({ text: e.textContent?.trim() ?? "", box: box(e) }))],
    };
  });
}

export function scaleOf(chart: Chart) {
  const [[p0, y0], [p1, y1]] = chart.ticks as [[number, number], [number, number]];
  const perPx = (p1 - p0) / (y1 - y0);
  return { priceAt: (y: number) => p0 + (y - y0) * perPx, yAt: (price: number) => y0 + (price - p0) / perPx, dollarsPerPx: Math.abs(perPx) };
}

export function overlaps(chart: Chart): string[] {
  const hits: string[] = [];
  chart.labels.forEach((a, i) =>
    chart.labels.slice(i + 1).forEach((b) => {
      const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (x > 1 && y > 1) hits.push(`${a.text} / ${b.text}`);
    }),
  );
  return hits;
}

export function sideways(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.getElementById("root")!;
    const page = document.documentElement;
    return Math.max(root.scrollWidth - root.clientWidth, page.scrollWidth - page.clientWidth);
  });
}

export function dollars(text: string): number[] {
  return [...text.matchAll(/\$[\d\s,.]+/g)].map((m) => Number(m[0].replace(/[$,\s]/g, "")));
}

export async function money(locator: Locator): Promise<number> {
  const [value] = dollars(await locator.ariaSnapshot());
  if (value === undefined) throw new Error(`no dollar amount in ${await locator.ariaSnapshot()}`);
  return value;
}

export async function tip(page: Page): Promise<{ price: number; payout: number; text: string }> {
  const text = (await tooltipOf(page).textContent()) ?? "";
  const [price = NaN, payout = NaN] = dollars(text);
  return { price, payout, text };
}

export async function pointAt(page: Page, x: number, y: number, touch: boolean) {
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.move(x, y);
}

export async function futureX(page: Page): Promise<number> {
  const chart = await geometry(page);
  const end = chart.labels.find((l) => l.text === "End");
  if (!end) throw new Error("no End label");
  return (end.box.left + end.box.right) / 2 + 30;
}

export async function connectDemo(page: Page) {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: /Demo wallet/ }).click();
  await expect(page.getByRole("button", { name: /^Buy (Up|Down)/ })).toBeVisible();
}

export function canvasPixels(canvas: Locator, x: number, y: number, width: number, height: number) {
  return canvas.evaluate(
    (element: HTMLCanvasElement, area) => {
      const box = element.getBoundingClientRect();
      const scale = element.width / box.width;
      const copy = document.createElement("canvas");
      copy.width = area.width * scale;
      copy.height = area.height * scale;
      const ctx = copy.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      ctx.drawImage(element, (area.x - box.left) * scale, (area.y - box.top) * scale, copy.width, copy.height, 0, 0, copy.width, copy.height);
      return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
    },
    { x, y, width, height },
  );
}

export function tintOf(data: number[]) {
  let up = 0;
  let down = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r = 0, g = 0, , a = 0] = data.slice(i, i + 4);
    if (a > 64 && g - r > 60) up++;
    if (a > 64 && r - g > 60) down++;
  }
  return up && down ? "mixed" : up ? "up" : down ? "down" : "none";
}

export async function openPopover(page: Page, label: string) {
  const expanded = page.getByRole("button", { expanded: true });
  if (await expanded.count()) await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: label, exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = trigger.locator("..").locator(":scope > span");
  await expect(panel).toBeVisible();
  return panel;
}
