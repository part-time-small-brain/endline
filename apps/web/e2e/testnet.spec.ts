import { connectDemo, expect, handleOf, money, settle, test } from "./fixtures.ts";

test("the testnet deposit sheet sends 100 test USDC once a day and says so when asked again", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("trade-mode", "pro"));
  await page.goto("/app");
  await settle(handleOf(page));
  await connectDemo(page);
  const balance = page.locator("header number-flow-react:visible");
  const before = await money(balance);
  const addFunds = page.getByRole("button", { name: "Add funds" });
  const sheet = page.getByRole("dialog");
  const get = sheet.getByRole("button", { name: "Get 100 test USDC" });

  await addFunds.click();
  await expect(sheet.getByRole("radiogroup", { name: "Deposit from" })).toHaveCount(0);
  await get.click();
  await expect(sheet.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect(sheet.getByRole("status")).toHaveText("Sent. Your balance updates in a few seconds.");
  await expect(get).toBeDisabled();
  await expect.poll(() => money(balance)).toBe(before + 100);

  await page.keyboard.press("Escape");
  await addFunds.click();
  await get.click();
  await expect(sheet.getByRole("status")).toHaveText("This account already got test USDC in the last 24 hours.");
  await expect(get).toBeEnabled();
  await expect.poll(() => money(balance)).toBe(before + 100);
});
