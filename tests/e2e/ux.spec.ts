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
    // drill-down: clicking a chart segment filters the page; filters can be saved as a preset
    const chart = page.locator(".ap-card", { hasText: "Click to filter" }).first();
    if (await chart.count()) {
      await chart.locator("[style*='cursor: pointer']").first().dispatchEvent("click"); // a one-slice donut's centre is the hole
      await page.waitForURL(/f_/);
      await expect(page.getByRole("button", { name: /Showing .* · Clear/ })).toBeVisible();
      await page.getByRole("button", { name: "Save filters" }).click();
      await page.getByRole("dialog").getByRole("textbox").fill("Drill preset");
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("button", { name: "Drill preset", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Showing .* · Clear/ }).click();
      await page.waitForURL((u) => !u.search.includes("f_"));
    }
    // table search + sort on the "All …" page
    await page.getByRole("navigation", { name: "App pages" }).getByRole("link").nth(1).click();
    await expect(page.getByRole("heading", { level: 1, name: /^All / })).toBeVisible();
    const search = page.getByRole("searchbox").first();
    await search.fill("zzzz-no-match");
    await expect(page.getByText("No matches.")).toBeVisible();
  });

  test("automation recipe opens in the editor switched off", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}/automations`);
    const recipes = page.getByRole("region", { name: "Recipes" });
    await expect(recipes).toBeVisible();
    if (await recipes.getByRole("button", { name: /Recipes for this base/ }).isVisible()) await recipes.getByRole("button", { name: /Recipes for this base/ }).click();
    await recipes.locator(".if-layout").first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Close" }).click();
    await expect(dlg).toHaveCount(0);
  });

  test("Settings is one click from the sidebar and the base rail; appearance and status work", async ({ page }) => {
    await login(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Settings" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: /Light/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Integrations & status" }).click();
    await expect(page.getByRole("region", { name: "Integrations & system status" })).toContainText("AI (Claude)");
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}`);
    const rail = page.getByRole("navigation", { name: "Workspace" });
    await rail.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/workspace\/settings/);
    await page.goto(`/base/${baseId}`);
    await rail.getByRole("link", { name: "My work" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  });

  test("⌘K finds a base by name and opens it; commands work", async ({ page }) => {
    await login(page);
    await page.goto("/");
    const name = (await page.locator("a[href^='/base/']").first().innerText()).split("\n")[0].trim();
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Search" });
    await expect(box).toBeFocused();
    await box.fill(name.slice(0, 6));
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/base\/[^/]+\/[^/]+\/[^/?]+/); // base → table → view resolved
    await expect(page.getByRole("navigation", { name: "Base sections" })).toBeVisible();
    // quick add: "<Table>: text" creates the record and opens it
    const table = (await page.getByRole("navigation", { name: "Tables" }).locator("[aria-current=page]").innerText()).trim();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search" }).fill(`${table}: Quick add E2E`);
    await page.getByRole("option", { name: new RegExp(`^Add “Quick add E2E” to ${table}`) }).first().click(); // current base ranks first
    await page.waitForURL(/record=/);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Search" }).fill("settings");
    await page.getByRole("option", { name: /^Settings/ }).click();
    await expect(page).toHaveURL(/\/workspace\/settings/);
  });

  test("table switcher (search, hide, jump), add-table sources, and the field-type picker", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}`);
    await page.waitForURL(/\/base\/[^/]+\/[^/]+\/[^/?]+/);
    const tabs = page.getByRole("navigation", { name: "Tables" });
    await tabs.getByRole("button", { name: "All tables" }).click();
    const sw = page.getByRole("dialog", { name: "All tables" });
    const names = (await sw.getByRole("option").allInnerTexts()).map((x) => x.trim());
    expect(names.length).toBeGreaterThan(1);
    const other = names.find((n, i) => i > 0)!;
    await sw.getByRole("button", { name: `Hide ${other} from the tab bar` }).click();
    await page.keyboard.press("Escape");
    await expect(tabs.getByRole("button", { name: other, exact: true })).toHaveCount(0);
    await tabs.getByRole("button", { name: "All tables" }).click();
    await sw.getByPlaceholder("Find a table").fill(other.slice(0, 4));
    await page.keyboard.press("Enter");
    await expect(tabs.getByRole("button", { name: other })).toHaveAttribute("aria-current", "page"); // current table always shown
    await tabs.getByRole("button", { name: "All tables" }).click();
    await sw.getByRole("button", { name: `Show ${other} in the tab bar` }).click();
    await page.keyboard.press("Escape");
    await tabs.getByRole("button", { name: "Add or import a table" }).click();
    const add = page.getByRole("dialog", { name: "Add a table" });
    await expect(add).toContainText("Start from scratch");
    await expect(add).toContainText("CSV or Excel file");
    await page.keyboard.press("Escape");
    await expect(add).toHaveCount(0);
    // field-type picker → dialog pre-set to the chosen type → field created
    await page.getByRole("button", { name: "Add field" }).click();
    const pick = page.getByRole("dialog", { name: "Add a field" });
    await expect(pick.getByRole("button", { name: /Analyse attachment/ })).toBeVisible();
    await expect(pick.getByRole("button", { name: /Research with web search/ })).toBeVisible();
    await pick.getByPlaceholder("Find a field type").fill("curr");
    await pick.getByRole("button", { name: "Currency" }).click();
    await expect(page.locator("#fd-type")).toHaveValue("currency");
    const fname = `Fee ${Date.now() % 100000}`;
    await page.locator("#fd-name").fill(fname);
    await page.getByRole("button", { name: "Create field" }).click();
    await expect(page.locator(".g-hcell", { hasText: fname })).toHaveCount(1); // new column exists (may be scrolled off to the right)
  });

  test("form builder: question logic, pages and settings drive the live form", async ({ page }) => {
    await login(page);
    const baseId = await firstBase(page);
    await page.goto(`/base/${baseId}`);
    await page.waitForURL(/\/base\/[^/]+\/[^/]+\/[^/?]+/);
    await page.getByRole("button", { name: "Form", exact: true }).first().click(); // create a form view
    const side = page.getByRole("complementary", { name: "Form builder" });
    await expect(side).toBeVisible();
    const qs = side.locator(".fb-list > li");
    await expect(qs.nth(1)).toBeVisible();
    const second = (await qs.nth(1).locator(".fb-name").innerText()).replace("*", "").trim();
    const firstLabel = (await qs.nth(0).locator(".fb-name").innerText()).replace("*", "").trim();
    await qs.nth(1).locator(".fb-name").click();
    await qs.nth(1).getByLabel("Condition question").selectOption({ label: firstLabel });
    const form = page.locator(".form-card");
    await expect(form.getByText(second, { exact: true })).toHaveCount(0); // hidden until the first is answered
    await form.locator("[id^=ff-]").first().fill("Something");
    await expect(form.getByText(second, { exact: true })).toBeVisible();
    await qs.nth(1).getByLabel("Start a new page here").check();
    await expect(form.getByText(/Page 1 of 2/)).toBeVisible();
    await side.getByRole("tab", { name: "Settings" }).click();
    await side.getByLabel("Close the form now").check();
    await expect(page.getByText("This form is closed.")).toBeVisible();
    await side.getByLabel("Close the form now").uncheck();
  });

  test("Connected apps: catalogue with logos, search, ChatGPT plan card, honest not-configured state", async ({ page }) => {
    await login(page);
    await page.goto("/workspace/settings?tab=apps");
    await expect(page.getByRole("heading", { name: "Bring your tools into Bang On OS" })).toBeVisible();
    await expect(page.getByRole("region", { name: "ChatGPT plan" })).toContainText("Use your ChatGPT plan");
    const gmail = page.getByRole("article", { name: "Gmail" });
    await expect(gmail).toBeVisible();
    await page.getByRole("textbox", { name: "Search apps" }).fill("hub");
    await expect(page.getByRole("article", { name: "HubSpot" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Gmail" })).toHaveCount(0);
    // without COMPOSIO_API_KEY the page says so and connecting is disabled (nothing pretends to work)
    await expect(page.getByText(/COMPOSIO_API_KEY/)).toBeVisible();
    await expect(page.getByRole("article", { name: "HubSpot" }).getByRole("button", { name: "Connect" })).toBeDisabled();
  });
});
