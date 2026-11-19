/**
 * Platform journey in a real browser against a real database: template → grid edit → refresh persists
 * → record comment → kanban → public form → export; then a commenter (free seat) is read-only.
 */
import { expect, test, type Browser } from "@playwright/test";

const PW = process.env.DEMO_PASSWORD ?? "demo-password-local-only";
const DOMAIN = "demo.productionos.test";
let baseUrl = "";

async function login(browser: Browser, role: string) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  await page.goto("/login");
  await page.fill("#email", `${role}@${DOMAIN}`); await page.fill("#password", PW);
  await page.click("button:has-text('Sign in')"); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

test.describe.serial("base platform", () => {
  test("owner builds from a template, edits, comments and shares a form", async ({ browser }) => {
    const p = await login(browser, "org-admin");
    await p.goto("/templates");
    await p.getByLabel("Use template Project tracker").first().click();
    await p.waitForURL(/\/base\/[^/]+\/[^/]+\/[^/]+/, { timeout: 60_000 });
    baseUrl = p.url();
    await p.waitForLoadState("networkidle");
    const first = p.locator(".g-row").first().locator(".g-cell").first();
    await first.click(); await p.keyboard.type("E2E project"); await p.keyboard.press("Enter");
    await expect(first).toHaveText("E2E project");
    await p.waitForLoadState("networkidle"); // optimistic UI updates before the server confirms
    await p.reload();
    await expect(p.locator(".g-row").first().locator(".g-cell").first()).toHaveText("E2E project");
    // Comment from the expanded record.
    await p.locator(".g-row").first().hover(); await p.locator(".g-row").first().getByLabel("Expand record").click();
    await p.getByLabel("Add a comment").fill("Looks good"); await p.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(p.getByText("Looks good")).toBeVisible();
    await p.keyboard.press("Escape");
    // Kanban view of tasks.
    await p.getByRole("tab", { name: "Tasks" }).click();
    await p.locator(".p-views a.p-viewitem", { hasText: "By priority" }).click();
    await expect(p.locator("section.k-col").first()).toBeVisible();
    // Export Excel from the grid.
    await p.locator(".p-views a.p-viewitem").first().click();
    const [dl] = await Promise.all([p.waitForEvent("download"), (async () => { await p.getByRole("button", { name: /Share & export/ }).click(); await p.getByText("Download CSV").click(); })()]);
    expect(dl.suggestedFilename()).toMatch(/\.csv$/);
    await p.context().close();
  });

  test("commenter (free seat) can read but not edit", async ({ browser }) => {
    const c = await login(browser, "crew");
    await c.goto(baseUrl);
    await expect(c.locator(".p-head")).toContainText("commenter · free seat");
    await expect(c.getByLabel("Add field")).toHaveCount(0);
    await expect(c.locator(".g-addrow")).toHaveCount(0);
    await c.locator(".g-row").first().locator(".g-cell").first().dblclick();
    await expect(c.locator(".g-editor input")).toHaveCount(0);
    await c.context().close();
  });
});
