/**
 * No-code app journeys in a real browser + real database: template app with live KPIs, detail page and
 * button action; builder drag/drop → autosave → reload → publish → App mode → rollback; client portal
 * scoped to the signed-in client with negative access checks. (Portal login: scripts/dev/ensure-portal-user.ts.)
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PW = process.env.DEMO_PASSWORD ?? "demo-password-local-only";
async function login(browser: Browser, email: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login"); await page.fill("#email", email); await page.fill("#password", PW);
  await page.click("button:has-text('Sign in')"); await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}
let crmUrl = "";

test.describe.serial("apps built with the no-code builder", () => {
  test("Agency CRM template: live KPIs, navigation, detail page and button action persist", async ({ browser }) => {
    const p = await login(browser, "org-admin@demo.productionos.test");
    await p.goto("/");
    await p.getByLabel("Use app template Agency CRM").first().click();
    await p.waitForURL(/\/a\/agency-crm/, { timeout: 90_000 }); crmUrl = new URL(p.url()).pathname;
    await expect(p.getByRole("region", { name: "Open deals" })).toContainText("6");
    await expect(p.getByRole("region", { name: "Pipeline value" })).toContainText("£99,000");
    await p.getByRole("navigation", { name: "App pages" }).getByRole("link", { name: "Clients" }).click();
    await expect(p.getByRole("heading", { name: "Clients", level: 1 })).toBeVisible();
    await p.goto(crmUrl);
    await p.getByRole("region", { name: "Active deals" }).getByText("Horizon Rebrand").click();
    await p.waitForURL(/\/deal\//);
    await p.getByRole("button", { name: "Mark as won" }).click();
    await expect(p.getByText("Updated.")).toBeVisible();
    await p.reload();
    await expect(p.locator(".ap-fields")).toContainText("Won");
    await p.goto(crmUrl);
    await expect(p.getByRole("region", { name: "Open deals" })).toContainText("5");
    await p.context().close();
  });

  test("builder: drag a component, autosave, reload, publish, App mode, rollback", async ({ browser }) => {
    const p = await login(browser, "org-admin@demo.productionos.test");
    await p.goto(crmUrl);
    await p.getByRole("link", { name: /Go to Builder/ }).click();
    await p.waitForURL(/\/builder\//); await p.waitForLoadState("networkidle");
    await p.getByLabel("Add Heading").dragTo(p.locator(".bd-dropzone"));
    const frame = p.locator(".bd-frame").last();
    await frame.click();
    await p.getByRole("complementary", { name: "Inspector" }).getByLabel("Title", { exact: true }).fill("E2E heading");
    await expect(p.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible({ timeout: 15_000 });
    await p.reload(); await p.waitForLoadState("networkidle");
    await expect(p.locator(".bd-canvas")).toContainText("E2E heading");
    await expect(p.locator(".ap-content")).toHaveCount(0);
    // Published app is unchanged until we publish.
    const app = await p.context().newPage(); await app.goto(crmUrl);
    await expect(app.locator(".ap-content")).not.toContainText("E2E heading");
    await p.getByRole("button", { name: "Publish" }).click();
    await p.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(p.getByText(/Published v2/)).toBeVisible();
    await app.reload(); await expect(app.locator(".ap-content")).toContainText("E2E heading");
    await p.getByRole("button", { name: "Versions" }).click();
    await Promise.all([p.waitForEvent("framenavigated", { timeout: 20_000 }), p.getByRole("dialog").getByRole("button", { name: "Roll back" }).first().click()]);
    await p.waitForLoadState("networkidle");
    await app.reload(); await expect(app.locator(".ap-content")).not.toContainText("E2E heading");
    await p.context().close();
  });

  test("client portal: scoped records, request form, and no workspace access", async ({ browser }) => {
    const owner = await login(browser, "org-admin@demo.productionos.test");
    await owner.goto("/");
    await owner.getByLabel("Use app template Client Portal").first().click();
    await owner.waitForURL(/\/a\/client-portal/, { timeout: 90_000 });
    await owner.context().close();
    const c = await login(browser, "client-portal@demo.productionos.test", { width: 390, height: 844 });
    await c.waitForURL(/\/a\/client-portal/);
    const projects = c.getByRole("region", { name: "Your projects" });
    await expect(projects).toContainText("Spring campaign");
    await expect(projects).not.toContainText("Gym launch film"); // another client's project
    await c.getByRole("region", { name: "Request something" }).getByRole("textbox").first().fill("Please add subtitles (E2E)");
    await c.getByRole("button", { name: "Send request" }).click();
    await expect(c.getByText("Thanks — your account manager has it.")).toBeVisible();
    await c.goto("/production"); await expect(c).not.toHaveURL(/\/production/);
    const res = await c.request.get("/templates"); expect(res.status()).toBeLessThan(500);
    await c.goto(crmUrl); await expect(c.getByText(/not found|could not be found/i)).toBeVisible();
    await c.context().close();
  });
});
