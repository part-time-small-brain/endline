import { expect, test } from "./fixtures.ts";

const APP = "http://127.0.0.1:5313";

test("the landing opens the app on its own origin, where Trade is the root", async ({ page }) => {
  await page.route("**/rpc", (route) => route.fulfill({ json: { jsonrpc: "2.0", id: "web", error: { message: "offline" } } }));
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-look", "near");
  const open = page.getByRole("link", { name: "Open app" }).first();
  await expect(open).toHaveAttribute("href", `${APP}/`);
  await open.click();
  await expect(page).toHaveURL(`${APP}/`);
  await expect(page.locator("html")).toHaveAttribute("data-look", "near");
  await expect(page.getByRole("link", { name: /Positions/ }).first()).toHaveAttribute("href", "/positions");
  await page.goto(`${APP}/app`);
  await expect(page.getByText("This page doesn't exist.")).toBeVisible();
});
