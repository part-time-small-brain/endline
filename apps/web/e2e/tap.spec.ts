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

async function connect(page: Page, wallet: RegExp) {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: wallet }).click();
}

async function setUpTapBalance(page: Page, wallet = /Demo wallet/) {
  await connect(page, wallet);
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Tap balance" });
  await sheet.getByRole("button", { name: "Set up with your wallet" }).click();
  await sheet.getByRole("button", { name: "Sign once more to check" }).click({ timeout: 10_000 });
  await expect(sheet.getByText("In your Tap balance")).toBeVisible({ timeout: 10_000 });
  await sheet.getByRole("button", { name: "Move $25 in" }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
}

async function stubEvm(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { ethereum: object; signatureByte: string; signs: number };
    w.signatureByte = "11";
    w.signs = 0;
    w.ethereum = {
      async request({ method }: { method: string }) {
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method !== "personal_sign") throw new Error(method);
        w.signs++;
        return `0x${w.signatureByte.repeat(64)}1b`;
      },
    };
  });
}

const signs = (page: Page) => page.evaluate(() => (window as unknown as { signs: number }).signs);
const signWith = (page: Page, byte: string) =>
  page.evaluate((value) => {
    (window as unknown as { signatureByte: string }).signatureByte = value;
  }, byte);

const seeds = (page: Page) => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("tap-seed:")));

test("Tap persists across reload and puts every Up cell above the spot line and every Down cell below it", async ({ page }) => {
  await openTap(page);
  await expect(page.locator("html")).toHaveAttribute("data-look", "near");
  await page.getByRole("button", { name: "Pro", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-look", "near");
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
  await expect(page.getByText("Max loss $10.50 a tap.", { exact: false })).toBeVisible();
  const cell = cells(page).filter({ hasNotText: "—" }).nth(5);
  const label = (await cell.getAttribute("aria-label")) ?? "";
  const [, side, price] = /^(Up|Down) · BTC ends (?:above|below) (\$[\d,]+) ·/.exec(label) ?? [];
  expect(price).toBeTruthy();
  await cell.click();
  await page.getByRole("dialog").getByRole("button", { name: /Demo wallet/ }).click();
  await expect(page.getByRole("button", { name: /^Account / })).toBeVisible();
  await grid(page).getByRole("button", { name: stable(label) }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("button", { name: /^Buy for \$/ })).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toContainText(`BTC ${side} ${price}`);
});

test("Tap keeps the stake when switching assets", async ({ page }) => {
  await openTap(page);
  await page.getByRole("radio", { name: "$50", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Asset" }).getByRole("radio", { name: /^ETH/ }).click();
  await expect(cells(page).first()).toHaveAccessibleName(/ETH ends/);
  await expect(page.getByRole("radio", { name: "$50", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Max loss $52.50 a tap.", { exact: false })).toBeVisible();
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

test("a Tap balance sets up once, then each tap buys at once with no dialog; Your taps sells back without the wallet and the rest moves back", async ({ page }) => {
  await openTap(page);
  await setUpTapBalance(page);
  const sheet = page.getByRole("dialog", { name: "Tap balance" });
  const tapBalance = page.getByText("Tap balance", { exact: true }).locator("..");
  await expect(tapBalance).toContainText("$25.00");

  await page.getByRole("radio", { name: "$10", exact: true }).click();
  const cell = cells(page).filter({ hasText: /^[12]\.\d×$/ }).last();
  const name = (await cell.getAttribute("aria-label")) ?? "";
  await cell.click();
  await expect(cell).toHaveAttribute("aria-busy", "true");
  const mine = page.getByRole("region", { name: "Your taps" });
  await expect(mine.getByRole("button", { name: /^Sell \$/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(grid(page).getByRole("button", { name: stable(name) })).toHaveAccessibleName(/ · you hold this$/);
  await expect(page.getByRole("status").filter({ hasText: /^Bought BTC (Up|Down) \$[\d,]+ for \$/ })).toBeVisible();
  await expect(tapBalance).not.toContainText("$25.00");

  await mine.getByRole("button", { name: /^Sell \$/ }).click();
  await page.getByRole("button", { name: /^Sell back for \$/ }).click({ timeout: 10_000 });
  await expect(page.getByText("Sold", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(mine).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole("link", { name: /^Positions/ }).click();
  await page.getByRole("link", { name: "Trade" }).click();
  await page.getByRole("button", { name: "Top up or move" }).click();
  await sheet.getByRole("button", { name: /^Move \$[\d.]+ to your balance$/ }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  await expect(tapBalance).toContainText("$0");
});

test("a bought cell rides into its column's final round, read-only, with the average so far", async ({ page }) => {
  await openTap(page);
  await setUpTapBalance(page);
  await page.getByRole("radio", { name: "$10", exact: true }).click();
  await cells(page).filter({ hasText: /^[1-9]\.\d×$/ }).and(page.getByRole("button", { name: / · Tomorrow / })).first().click();
  await expect(page.getByRole("status").filter({ hasText: /^Bought BTC (Up|Down) \$[\d,]+ for \$/ })).toBeVisible({ timeout: 10_000 });
  const now = await page.evaluate(() => Date.now());
  const day = 86_400_000;
  const expiry = Math.floor((now + 1_800_000 - 8 * 3_600_000) / day) * day + 8 * 3_600_000 + day;
  await page.clock.fastForward(expiry - 29 * 60_000 - now);
  await expect(page.getByText(/^Final round · average so far ≈ \$[\d,]+\. /)).toBeVisible();
  await expect(grid(page).getByRole("group", { name: /· final round · (on track to pay about \$[\d,.]+|on track to pay nothing|too close to call) · you hold this$/ })).toBeVisible();
  await expect(grid(page).getByRole("button", { name: / · Today / })).toHaveCount(0);
});

test("free calls with the demo wallet: call a cell of the next round, see it called and counted, and the board", async ({ page }) => {
  await openTap(page);
  await connect(page, /Demo wallet/);
  await page.getByRole("radio", { name: /^Free call/ }).click();
  await expect(page.getByRole("radio", { name: /^Free call/ })).toContainText("10 of 10 left this round");
  await cells(page).filter({ hasText: /^[1-9]\.\d×$/ }).and(page.getByRole("button", { name: / · Tomorrow / })).first().click();
  await expect(page.getByRole("status").filter({ hasText: /^Called BTC (Up|Down) \$[\d,]+ at \d+\.\d×\.$/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("radio", { name: /^Free call/ })).toContainText("9 of 10 left this round");
  await expect(grid(page).getByRole("button", { name: / · you called this$/ })).toHaveCount(1);
  const panel = page.getByRole("region", { name: "Free calls" });
  await expect(panel.getByText(/· at \d+\.\d×/)).toBeVisible();
  await expect(panel.getByRole("list").first().getByRole("listitem").first()).toContainText("sun.near");
  await page.getByRole("radio", { name: /^Buy/ }).click();
  await expect(page.getByRole("region", { name: "Free calls" })).toHaveCount(0);
});

test("a custom stake's max loss rounds up, so no tap costs more than it says", async ({ page }) => {
  await openTap(page);
  await page.getByRole("radio", { name: "Other" }).click();
  await page.getByRole("textbox", { name: "Amount in dollars" }).fill("101");
  await expect(page.getByText("Max loss $107 a tap.", { exact: false })).toBeVisible();
});

test("the Tap key outlives a reload, and a disconnect drops it and every tap still queued", async ({ page }) => {
  await openTap(page);
  await setUpTapBalance(page);
  await page.reload();
  await connect(page, /Demo wallet/);
  await expect(page.getByRole("button", { name: "Top up or move" })).toBeVisible();
  expect(await seeds(page)).toEqual(["tap-seed:mainnet:demo.near"]);

  await page.getByRole("button", { name: "Top up or move" }).click();
  const sheet = page.getByRole("dialog", { name: "Tap balance" });
  await sheet.getByRole("button", { name: "Move $25 in" }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  await page.getByRole("radio", { name: "$10", exact: true }).click();
  const priced = cells(page).filter({ hasText: /×$/ });
  for (const i of [0, 1, 2]) await priced.nth(i).click();
  await expect(grid(page).locator("[aria-busy=true]")).not.toHaveCount(0);
  await page.getByRole("button", { name: /^Account / }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  expect(await seeds(page)).toEqual([]);
  await expect(grid(page).locator("[aria-busy=true]")).toHaveCount(0, { timeout: 10_000 });
});

test("a Tap balance the wallet can no longer open says why when selling back", async ({ page }) => {
  await stubEvm(page);
  await openTap(page);
  await setUpTapBalance(page, /Ethereum wallet/);
  await page.getByRole("radio", { name: "$10", exact: true }).click();
  await cells(page).filter({ hasText: /^[12]\.\d×$/ }).last().click();
  await expect(page.getByRole("region", { name: "Your taps" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Account / }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await signWith(page, "22");
  await connect(page, /Ethereum wallet/);
  await page.getByRole("link", { name: /^Positions/ }).click();
  await page.getByRole("article").filter({ has: page.getByText("Tap", { exact: true }) }).getByRole("button", { name: "Sell back" }).click();
  await expect(page.getByRole("alert")).toHaveText("This wallet signed differently than last time, so it can't open the same Tap balance.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("setting up asks the wallet once per click, so no popup opens without one, and refuses a wallet whose signatures vary", async ({ page }) => {
  await stubEvm(page);
  await openTap(page);
  await connect(page, /Ethereum wallet/);
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Tap balance" });
  await sheet.getByRole("button", { name: "Set up with your wallet" }).click();
  const again = sheet.getByRole("button", { name: "Sign once more to check" });
  await expect(again).toBeVisible();
  expect(await signs(page)).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Set up", exact: true }).click();
  await expect(again).toBeVisible();
  await signWith(page, "22");
  await again.click();
  await expect(sheet.getByRole("alert")).toHaveText("This wallet signs the same message differently each time, so it can't hold a Tap balance.");
  await expect(sheet.getByText("In your Tap balance")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Set up with your wallet" }).click();
  await again.click();
  await expect(sheet.getByText("In your Tap balance")).toBeVisible();
  expect(await signs(page)).toBe(4);
});

test("a new tab opens the Tap balance with its own click before moving money", async ({ page }) => {
  await stubEvm(page);
  await openTap(page);
  await setUpTapBalance(page, /Ethereum wallet/);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await connect(page, /Ethereum wallet/);
  await page.getByRole("button", { name: "Top up or move" }).click();
  const sheet = page.getByRole("dialog", { name: "Tap balance" });
  await expect(sheet.getByRole("button", { name: "Move $25 in" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Open with your wallet" }).click();
  await expect(sheet.getByRole("button", { name: "Move $25 in" })).toBeVisible();
  expect(await signs(page)).toBe(1);
  await sheet.getByRole("button", { name: "Move $25 in" }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  expect(await signs(page)).toBe(2);
});
