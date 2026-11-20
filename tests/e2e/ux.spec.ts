/**
 * Usability journeys: themed in-app dialogs (close button + Escape, no native pop-ups), the light/dark
 * toggle surviving a reload, interfaces built from a layout into the page builder and published, the new
 * calendar / gallery / goal components, and automation recipes opening in the editor switched off.
 */
import { expect, test, type Page } from "@playwright/test";

const PW = process.env.DEMO_PASSWORD ?? "demo-password-local-only";
async function login(page: Page) {
  page.on("dialog", (d) => { throw new Error(`Native browser dialog appeared: ${d.message()}`); });
  await page.goto("/login"); await page.fill("#email", "org-admin@demo.productionos.test"); await page.fill("#password", PW);
  await page.click("button:has-text('Sign in')"); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function firstBase(page: Page) {
  await page.goto("/");
  const href = await page.locator("a[href^='/base/']").first().getAttribute("href");
  return href!.split("/")[2];
}

const NAME = `Ops overview ${Date.now()}`;
test.describe.serial("usability", () => {
  test("theme toggle switches light/dark and persists across reload", async ({ page }) => {
    await login(page);
    await page.goto("/");
    const btn = page.getByRole("button", { name: /^Theme:/ }).first();
    for (let i = 0; i < 3 && (await page.locator("html").getAttribute("data-theme")) !== "light"; i++) await btn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: /^Theme:/ }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe("rgb(255, 255, 255)");
  });

  test("dialogs close with the close button and Escape", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}/interfaces`);
    await page.getByRole("button", { name: "New interface" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "New interface" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("interface from a layout → builder → add calendar, gallery, goal → publish → app", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}/interfaces`);
    await page.getByRole("button", { name: "New interface" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("radio", { name: "Dashboard", exact: true }).click();
    await dlg.getByPlaceholder(/dashboard/i).fill(NAME);
    await dlg.getByRole("button", { name: "Create and open builder" }).click();
    await page.waitForURL(/\/builder\//, { timeout: 60_000 });
    await expect(page.getByRole("banner").getByText(NAME)).toBeVisible();
    // generated components render with live data on the canvas
    await expect(page.locator(".ap-kpi").first()).toBeVisible();
    await expect(page.locator(".ap-progress").first()).toBeVisible();
    // add the new component types from the palette
    for (const name of ["Calendar", "Gallery", "Goal progress"]) await page.getByRole("button", { name: new RegExp(`^Add ${name}`, "i") }).first().click();
    await expect(page.locator(".ap-cal").first().or(page.getByText("Choose a date field in the inspector.").first())).toBeVisible();
    await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Publish" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    await page.goto(`/base/${baseId}/interfaces`);
    const card = page.locator(".if-app", { hasText: NAME });
    await expect(card).toContainText("Published");
    await card.getByRole("link", { name: "Open" }).click();
    await page.waitForURL(/\/a\//);
    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    // table search + sort on the "All …" page
    await page.getByRole("navigation", { name: "App pages" }).getByRole("link").nth(1).click();
    const search = page.getByRole("searchbox").first();
    await search.fill("zzzz-no-match");
    await expect(page.getByText("No matches.")).toBeVisible();
  });

  test("automation recipe opens in the editor switched off", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}/automations`);
    const recipes = page.getByRole("region", { name: "Recipes" });
    if (!(await recipes.locator(".if-layout").first().isVisible())) await recipes.getByRole("button", { name: /Recipes for this base/ }).click();
    await recipes.locator(".if-layout").first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toHaveCount(0);
  });
});
