/**
 * Acceptance 2, 7, 9, 10, 27, 28, 30 — the first-release journey through the real browser UI and a real
 * database: create show → episode → scene → link people/resources → shots → shoot day → conflicts →
 * issue call sheet → hand over to post → approve & deliver; then verify persistence in a second session
 * and role denials. Uses accounts from the labelled demo seed (DEMO_PASSWORD).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PW = process.env.DEMO_PASSWORD ?? "demo-password-local-only";
const DOMAIN = "demo.productionos.test";
const RUN = Date.now().toString(36);
const SHOW = `E2E Show ${RUN}`;
let productionUrl = "";

async function login(browser: Browser, role: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto("/login");
  await page.fill("#email", `${role}@${DOMAIN}`);
  await page.fill("#password", PW);
  await page.click("button:has-text('Sign in')");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  return page;
}

async function pickOption(page: Page, selector: string | ReturnType<Page["locator"]>, label: string | RegExp) {
  const sel = typeof selector === "string" ? page.locator(selector) : selector;
  const opt = sel.locator("option", { hasText: label });
  await expect(opt.first()).toBeAttached();
  await sel.selectOption({ label: (await opt.first().textContent())!.trim() });
}

test.describe.serial("producer journey", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await login(browser, "producer"); });

  test("create a show and an episode", async () => {
    await page.goto("/productions");
    await page.click("button:has-text('New production')");
    await page.fill("#f-productions-title", SHOW);
    await page.selectOption("#f-productions-kind", "gameshow");
    await page.click("button:has-text('Create production')");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: SHOW }).click();
    await page.waitForURL(/\/productions\/[0-9a-f-]{36}$/);
    productionUrl = new URL(page.url()).pathname;
    await page.goto(`${productionUrl}?tab=episodes`);
    await page.click("button:has-text('New episode / unit')");
    await page.fill("#f-episodes-number", "1");
    await page.fill("#f-episodes-title", "E2E Heat");
    await page.click("button:has-text('Create episode / unit')");
    await expect(page.getByRole("link", { name: "E2E Heat" })).toBeVisible();
  });

  test("add a segment, link people and resources, build the shot list", async () => {
    await page.goto(`${productionUrl}?tab=scenes`);
    await page.click("button:has-text('New scene / segment')");
    await pickOption(page, "#f-scenes-episodeId", /E2E Heat/);
    await page.fill("#f-scenes-number", "1");
    await page.selectOption("#f-scenes-kind", "round");
    await page.fill("#f-scenes-title", "E2E Round");
    await page.fill("#f-scenes-director", "E2E Director");
    await page.fill("#f-scenes-estDurationMins", "30");
    await page.click("button:has-text('Create scene / segment')");
    await page.getByRole("link", { name: "E2E Round" }).click();
    await page.waitForURL(/\/scenes\/[0-9a-f-]{36}$/);

    // Automation: scene name + director → exactly one auto master shot.
    await page.reload();
    await expect(page.locator("[aria-label='Shot list'] tbody .badge", { hasText: "auto" })).toHaveCount(1);

    const people = page.getByRole("region", { name: "Cast and crew" });
    await pickOption(page, people.locator("select").first(), "Demo Host Ava Reid");
    await people.locator("select").nth(1).selectOption("host");
    await people.getByRole("button", { name: "Link person" }).click();
    await expect(people.getByRole("link", { name: "Demo Host Ava Reid" })).toBeVisible();

    const req = page.getByRole("region", { name: "Requirements" });
    await pickOption(page, req.locator("select").first(), "Contestant buzzer set");
    await req.getByRole("button", { name: "Add" }).click();
    await expect(req.getByRole("link", { name: "Contestant buzzer set" })).toBeVisible();

    await page.fill("[aria-label='Shot description']", "Contestant reaction ISO");
    await page.click("button:has-text('Add shot')");
    await expect(page.locator("[aria-label='Shot list'] tbody tr")).toHaveCount(2);

    // Persisted after a full reload.
    await page.reload();
    await expect(people.getByRole("link", { name: "Demo Host Ava Reid" })).toBeVisible();
    await expect(req.getByRole("link", { name: "Contestant buzzer set" })).toBeVisible();
    await expect(page.locator("[aria-label='Shot list'] tbody tr")).toHaveCount(2);
  });

  test("schedule a shoot day and see cross-production conflicts", async () => {
    const pid = productionUrl.split("/").pop();
    await page.goto(`/schedule?tab=stripboard&production=${pid}`);
    await page.fill("[aria-label='New shoot day date']", "2027-03-10");
    await page.click("button:has-text('Add day')");
    await expect(page.locator(".lane h3 a").first()).toBeVisible();
    await page.locator("[aria-label='Add scene 1 to a day']").selectOption({ index: 1 });
    await expect(page.locator(".lane .card", { hasText: "E2E Round" })).toBeVisible();
    await page.locator(".lane h3 a").first().click();
    await page.waitForURL(/\/schedule\/day\//);
    // Buzzers (qty 1) are also needed by the demo gameshow's studio day on the same date.
    await expect(page.getByText("Resource overcommitted").first()).toBeVisible();
    await expect(page.getByText(/Contestant buzzer set: \d+ needed on 2027-03-10 but only 1 available/)).toBeVisible();
  });

  test("issue a versioned call sheet", async () => {
    await page.click("button:has-text('Issue call sheet v1')");
    await page.getByRole("dialog").locator("input[type=checkbox]").check();
    await page.getByRole("dialog").getByRole("button", { name: "Issue version" }).click();
    await page.waitForURL(/\/callsheets\//);
    await expect(page.getByText("Call sheet · version 1")).toBeVisible();
    await expect(page.getByText("E2E Round")).toBeVisible();
    await expect(page.getByText("Demo Host Ava Reid").first()).toBeVisible();
    await page.goBack();
  });

  test("hand the shoot over to post and deliver", async () => {
    await page.click("button:has-text('Wrap & hand over to post')");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Wrapped — post tasks created")).toBeVisible();
    await page.goto(`${productionUrl}?tab=post`);
    await expect(page.getByRole("link", { name: /Ingest & verify rushes/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Assembly edit" })).toBeVisible();

    await page.goto(`${productionUrl}?tab=deliverables`);
    await page.click("button:has-text('New deliverable')");
    await page.fill("#f-deliverables-title", "E2E Master");
    await page.click("button:has-text('Create deliverable')");
    await page.getByRole("link", { name: "E2E Master" }).click();
    await page.click("button:has-text('Move to in progress')");
    await page.click("button:has-text('Move to ready for approval')");
    await page.click("button:has-text('Approve deliverable')");
    await page.click("button:has-text('Mark delivered')");
    await expect(page.locator("h1 .badge", { hasText: "Delivered" })).toBeVisible();
  });

  test("everything persists for a second authorised session", async ({ browser }) => {
    const admin = await login(browser, "org-admin");
    await admin.goto(`${productionUrl}?tab=deliverables`);
    await expect(admin.getByRole("row", { name: /E2E Master/ }).getByText("Delivered")).toBeVisible();
    await admin.goto(`${productionUrl}?tab=scenes`);
    await expect(admin.getByRole("link", { name: "E2E Round" })).toBeVisible();
    await admin.context().close();
  });
});

test.describe("role security in the browser", () => {
  test("cast sees only their schedule; finance and productions are blocked", async ({ browser }) => {
    const cast = await login(browser, "cast");
    await cast.goto("/my"); // home is now the workspace (bases); the production schedule lives at /my
    await expect(cast).toHaveURL(/\/my$/);
    await expect(cast.getByRole("heading", { name: "My schedule" })).toBeVisible();
    await cast.goto("/budgets");
    await expect(cast.getByText("Not available for your role")).toBeVisible();
    await cast.goto("/people");
    await expect(cast.getByText("Not available for your role")).toBeVisible();
    const res = await cast.request.get("/api/export/budgets");
    expect(res.status()).toBe(403);
    await cast.context().close();
  });

  test("crew cannot see budgets or personal data but can see shot lists", async ({ browser }) => {
    const crew = await login(browser, "crew");
    await crew.goto("/budgets");
    await expect(crew.getByText("Not available for your role")).toBeVisible();
    expect((await crew.request.get("/api/export/people")).status()).toBe(403);
    await crew.goto("/productions");
    await expect(crew.getByRole("link", { name: "Demo: Night Shift — Pilot" })).toBeVisible();
    await expect(crew.getByRole("link", { name: "Demo: Brain Drain — Series 1" })).toHaveCount(0);
    await crew.context().close();
  });

  test("unauthenticated requests are redirected or rejected", async ({ request }) => {
    expect((await request.get("/api/export/productions")).status()).toBe(401);
    expect((await request.get("/api/v1/productions")).status()).toBe(401);
    expect((await request.get("/api/jobs/run")).status()).toBe(401);
  });
});

test.describe("responsive layouts (acceptance 27)", () => {
  for (const vp of [{ name: "tablet", width: 1024, height: 768 }, { name: "mobile", width: 390, height: 844 }]) {
    test(`no horizontal page overflow at ${vp.name} ${vp.width}px`, async ({ browser }) => {
      const p = await login(browser, "producer", { width: vp.width, height: vp.height });
      for (const path of ["/", "/productions", "/schedule", "/approvals", "/post"]) {
        await p.goto(path);
        await p.waitForLoadState("networkidle");
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
      }
      await p.goto("/schedule?month=2027-03");
      await p.waitForLoadState("networkidle");
      await p.locator(".cal .ev").first().click();
      await p.waitForURL(/\/schedule\/day\//);
      await expect(p.getByRole("heading", { name: "Shoot-Day Command" })).toBeVisible();
      await p.screenshot({ path: `test-results/day-command-${vp.name}.png`, fullPage: false });
      if (vp.width < 900) {
        await p.getByRole("button", { name: "Open navigation" }).click();
        await expect(p.getByRole("link", { name: "Productions" })).toBeVisible();
      }
      await p.context().close();
    });
  }
});

test.describe("customisation (wizard, custom fields, rules)", () => {
  test("build a production from a template and use a custom field", async ({ browser }) => {
    const admin = await login(browser, "org-admin");
    const title = `Wizard Panel ${Date.now().toString(36)}`;
    await admin.goto("/productions/new");
    await admin.getByRole("button", { name: "Use template Panel / chat show" }).click();
    await admin.fill("#w-title", title);
    await admin.fill("#w-units", "2");
    await expect(admin.getByRole("complementary", { name: "What will be created" })).toContainText("12");
    await admin.click("button:has-text('Create production')");
    await admin.waitForURL(/\/productions\/[0-9a-f-]{36}$/);
    const scenesUrl = admin.url() + "?tab=scenes";
    await admin.goto(scenesUrl);
    await expect(admin.getByRole("link", { name: "Guest introductions" }).first()).toBeVisible();
    await expect(admin.locator("table.data tbody tr")).toHaveCount(12);

    // Org-defined custom field appears on the grid and can be edited inline.
    await admin.goto("/settings?tab=fields");
    const label = `Cue ${Date.now().toString(36)}`;
    await admin.selectOption("#cf-entity", "scenes");
    await admin.fill("#cf-label", label);
    await admin.click("button:has-text('Add field')");
    await expect(admin.getByText(label).first()).toBeVisible();
    await admin.goto(scenesUrl);
    await admin.waitForLoadState("networkidle"); // edit only after hydration
    await expect(admin.getByRole("columnheader", { name: label })).toBeVisible();
    const row = admin.locator("table.data tbody tr").first();
    const editor = row.getByRole("textbox", { name: label });
    await row.getByRole("button", { name: `Edit ${label}` }).click();
    await expect(editor).toBeVisible();
    await editor.fill("GFX-001");
    await expect(editor).toHaveValue("GFX-001");
    await editor.press("Enter");
    await expect(row.getByRole("button", { name: `Edit ${label}` })).toHaveText("GFX-001");
    await admin.goto(scenesUrl);
    await expect(admin.locator("table.data tbody tr").first().getByRole("button", { name: `Edit ${label}` })).toHaveText("GFX-001");
    await admin.context().close();
  });
});
