import type { Page } from "@playwright/test";
import { expect, settle, sideways, test } from "./fixtures.ts";

const grid = (page: Page) => page.getByRole("table");
const cells = (page: Page) => grid(page).getByRole("button");
const stable = (label: string) => new RegExp(`^${label.replace(/ · pays up to .*$/, "").replace(/[$.*+?^()|[\]\\]/g, "\\$&")} · `);

async function openTap(page: Page) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Tap", exact: true }).click();
  await expect(cells(page).first()).toBeVisible();
}

async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Demo wallet/ }).click();
}

test("Tap persists across reload and puts every Up cell above the spot line and every Down cell below it", async ({ page }) => {
  await openTap(page);
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await page.getByRole("button", { name: "Tap", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Tap", exact: true })).toHaveAttribute("aria-pressed", "true");
  const line = page.getByRole("region", { name: "Tap grid" }).locator("span.border-dashed");
  await settle(line);
  const { spotY, up, down } = await page.getByRole("region", { name: "Tap grid" }).evaluate((region) => {
    const center = (element: Element) => {
      const box = element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const buttons = [...region.querySelectorAll("tbody button")];
    const of = (side: string) => buttons.filter((b) => b.getAttribute("aria-label")?.startsWith(side)).map(center);
    return { spotY: center(region.querySelector("span.border-dashed")!), up: of("Up"), down: of("Down") };
  });
  expect(up.length).toBeGreaterThan(0);
  expect(down.length).toBeGreaterThan(0);
  expect(Math.max(...up)).toBeLessThan(spotY);
  expect(Math.min(...down)).toBeGreaterThan(spotY);
});

test("a tap asks for a wallet first, then confirms exactly that cell at the chosen stake", async ({ page }) => {
  await openTap(page);
  await page.getByRole("radio", { name: "$10", exact: true }).click();
  await expect(page.getByText("Each tap gets a firm quote for up to $10. Long shots cost less, since one trade's payout is capped. You confirm it before anything is bought.")).toBeVisible();
  const cell = cells(page).filter({ hasNotText: "—" }).nth(5);
  const label = (await cell.getAttribute("aria-label")) ?? "";
  const [, side, price] = /^(Up|Down) · BTC ends (?:above|below) (\$[\d,]+) ·/.exec(label) ?? [];
  expect(price).toBeTruthy();
  await cell.click();
  await page.getByRole("dialog").getByRole("button", { name: /Demo wallet/ }).click();
  await expect(page.getByRole("button", { name: /^Account / })).toBeVisible();
  await expect(page.getByText("Tap balance")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set up", exact: true })).toHaveCount(0);
  await grid(page).getByRole("button", { name: stable(label) }).click();
  const sheet = page.getByRole("dialog");
  const buy = sheet.getByRole("button", { name: /^Buy for \$/ });
  await expect(buy).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toContainText(`BTC ${side} ${price}`);
  const paid = Number((await buy.textContent())?.replace(/[^\d.]/g, ""));
  expect(paid).toBeGreaterThan(9);
  expect(paid).toBeLessThan(11);
});

test("with BTC the only asset, no mode offers an asset picker and Lite names it in plain text", async ({ page }) => {
  await openTap(page);
  await expect(cells(page).first()).toHaveAccessibleName(/^(Up|Down) · BTC ends /);
  await expect(page.getByRole("radiogroup", { name: "Asset" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Price to beat" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Asset" })).toHaveCount(0);
  await page.getByRole("button", { name: "Lite", exact: true }).click();
  await expect(page.getByLabel("Trade sentence")).toContainText("BTC ends above", { useInnerText: true });
  await expect(page.getByRole("button", { name: "Trade asset", exact: true })).toHaveCount(0);
});

test("Tap fits phones down to 320 px without sideways scrolling", async ({ page, isMobile }) => {
  test.skip(!isMobile, "desktop scrollbars take part of a phone-sized window");
  await openTap(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("group", { name: "Trade view" })).toBeInViewport({ ratio: 1 });
    const last = await cells(page).last().boundingBox();
    expect(last!.x + last!.width).toBeLessThanOrEqual(width);
  }
});

test("a bought cell rides into its column's final round, read-only, with the average so far", async ({ page }) => {
  await openTap(page);
  await connect(page);
  await page.getByRole("radio", { name: "$10", exact: true }).click();
  const first = (await grid(page).getByRole("columnheader").filter({ hasNotText: /final round|price to beat/i }).first().innerText()).split("\n")[0]!;
  const cell = cells(page).filter({ hasText: /^[1-9]\.\d×$/ }).and(page.getByRole("button", { name: new RegExp(` · ${first} `, "i") })).first();
  const label = (await cell.getAttribute("aria-label")) ?? "";
  await cell.click();
  await page.getByRole("button", { name: /^Buy for \$/ }).click({ timeout: 10_000 });
  await expect(page.getByText("You're in")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(grid(page).getByRole("button", { name: stable(label) })).toHaveAccessibleName(/ · you hold this$/);
  const now = await page.evaluate(() => Date.now());
  const day = 86_400_000;
  const expiry = Math.floor((now + 1_800_000 - 8 * 3_600_000) / day) * day + 8 * 3_600_000 + day;
  await page.clock.fastForward(expiry - 29 * 60_000 - now);
  await expect(page.getByText(/^Final round · average so far ≈ \$[\d,]+\. /)).toBeVisible();
  await expect(grid(page).getByRole("group", { name: /· final round · (on track to pay about \$[\d,.]+|on track to pay nothing|too close to call) · you hold this$/ })).toBeVisible();
  await expect(grid(page).getByRole("button", { name: / · Today / })).toHaveCount(0);
  await page.clock.fastForward(30 * 60_000);
  await expect(grid(page).getByRole("group", { name: /· ended · waiting for the final price · you hold this$/ })).toBeVisible();
  await expect(page.getByText("Ended · waiting for the final price.", { exact: true })).toBeVisible();
});

test("free calls with the demo wallet: call a cell of the next round, see it called and counted, and the board", async ({ page }) => {
  await openTap(page);
  await connect(page);
  await page.getByRole("radio", { name: /^Free call/ }).click();
  await expect(page.getByRole("radio", { name: /^Free call/ })).toContainText("10 of 10 left this round");
  await cells(page).filter({ hasText: /^[1-9]\.\d×$/ }).and(page.getByRole("button", { name: / · Tomorrow / })).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Confirm in your wallet. One signature proves this wallet is yours for 24 h. No funds move." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Called BTC (Up|Down) \$[\d,]+ at \d+\.\d×\.$/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: /^Free call/ })).toContainText("9 of 10 left this round");
  await expect(grid(page).getByRole("button", { name: / · you called this$/ })).toHaveCount(1);
  const panel = page.getByRole("region", { name: "Free calls" });
  await expect(panel.getByText(/· at \d+\.\d×/)).toBeVisible();
  await expect(panel.getByRole("list").first().getByRole("listitem").first()).toContainText("sun.near");
  await page.getByRole("radio", { name: /^Buy/ }).click();
  await expect(page.getByRole("region", { name: "Free calls" })).toHaveCount(0);
});

