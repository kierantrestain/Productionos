/**
 * DEMO WORKSPACE — a separate, clearly flagged demonstration organisation (organisations.is_demo = true).
 * Every name is fictional and prefixed "Demo". Nothing here is, or may be presented as, imported Airtable data.
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, organisations } from "@/db/schema";
import type { Role } from "@/lib/permissions";
import { contextForUser } from "@/server/auth/sessions";
import { createEntity, updateEntity } from "@/server/entities/crud";
import { createOrganisation, createUserWithMembership } from "@/server/services/admin";
import { addBlock, addSceneToDay, linkScenePerson, linkSceneResource, upsertCall } from "@/server/services/production-ops";
import { requestApproval, decideApproval } from "@/server/services/approvals";
import { processOutbox } from "@/server/workflows/engine";

export const DEMO_SLUG = "bang-on-demo";
export const DEMO_DOMAIN = "demo.productionos.test";
const SLUG = DEMO_SLUG;
const DOMAIN = DEMO_DOMAIN;

/** Creates the demo org. If ownerUserId is given, that user becomes its org admin (no "Demo Admin" login). */
export async function seedDemo(opts: { password?: string; reset?: boolean; ownerUserId?: string } = {}) {
  const [existing] = await db.select().from(organisations).where(eq(organisations.slug, SLUG));
  if (existing) {
    if (!opts.reset) return { orgId: existing.id, created: false, password: null as string | null };
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local app.allow_history_purge = 'on'`);
      await tx.delete(organisations).where(eq(organisations.id, existing.id));
    });
  }
  const password = opts.password || randomBytes(12).toString("base64url");
  const org = await createOrganisation({ name: "Bang On — Demo Workspace", slug: SLUG, isDemo: true });
  const mk = async (role: Role, name: string, personId?: string) => {
    const u = await createUserWithMembership({ orgId: org.id, role, email: `${role.replace(/_/g, "-")}@${DOMAIN}`, name, password, personId });
    return (await contextForUser(u.id, org.id))!;
  };
  let admin;
  if (opts.ownerUserId) {
    await db.insert(memberships).values({ orgId: org.id, userId: opts.ownerUserId, role: "org_admin" }).onConflictDoNothing();
    admin = (await contextForUser(opts.ownerUserId, org.id))!;
  } else admin = await mk("org_admin", "Demo Admin");
  const exec = await mk("executive", "Demo Executive");
  const C = (e: string, v: Record<string, unknown>) => createEntity(admin, e, v);

  // ── Organisation & slate ──
  const bu = await C("business_units", { name: "Demo Studio Entertainment", code: "DSE", status: "active" });
  const le = await C("legal_entities", { name: "Demo Productions Ltd", kind: "company", businessUnitId: bu.id });
  const ipQuiz = await C("ip_projects", { title: "Demo: Brain Drain", formatType: "gameshow", stage: "in_production", genre: "Quiz", businessUnitId: bu.id, legalEntityId: le.id, logline: "Four contestants, one buzzer, and a prize pot that drains every time they hesitate.", rightsStatus: "owned" });
  const ipDrama = await C("ip_projects", { title: "Demo: Night Shift", formatType: "scripted_series", stage: "in_production", genre: "Comedy drama", businessUnitId: bu.id, legalEntityId: le.id, rightsStatus: "optioned", nextMilestone: "Series commission decision", nextMilestoneDate: "2027-06-30" });
  const ipDoc = await C("ip_projects", { title: "Demo: Coastline", formatType: "documentary", stage: "packaging", genre: "Factual", businessUnitId: bu.id, decisionDate: "2027-04-15", nextMilestone: "Broadcaster pitch" });
  await C("greenlight_gates", { ipProjectId: ipDoc.id, gate: "packaging", dueDate: "2027-04-15" });
  const gate = await C("greenlight_gates", { ipProjectId: ipDoc.id, gate: "greenlight", dueDate: "2027-05-30" });
  await C("development_materials", { ipProjectId: ipDoc.id, title: "Coastline treatment", kind: "treatment", versionLabel: "v3", status: "in_review" });
  await C("creative_reviews", { ipProjectId: ipDrama.id, kind: "coverage", reviewer: "Demo Script Reader", rating: 8, recommendation: "recommend", reviewedOn: "2026-10-02" });
  await C("packaging_items", { ipProjectId: ipDoc.id, name: "Demo Presenter Candidate", kind: "presenter", status: "interested" });

  // ── Shared people & companies ──
  const agency = await C("companies", { name: "Demo Talent Agency", kind: "agency" });
  const hire = await C("companies", { name: "Demo Camera Hire", kind: "supplier" });
  const caterer = await C("companies", { name: "Demo Catering Co", kind: "supplier" });
  const broadcaster = await C("companies", { name: "Demo Broadcaster", kind: "broadcaster" });
  const brand = await C("companies", { name: "Demo Snacks Brand", kind: "sponsor" });
  const P: Record<string, string> = {};
  for (const [k, name, dept] of [
    ["host", "Demo Host Ava Reid", "Talent"], ["c1", "Demo Contestant Sam", "Contestants"], ["c2", "Demo Contestant Priya", "Contestants"], ["c3", "Demo Contestant Tom", "Contestants"], ["c4", "Demo Contestant Lena", "Contestants"],
    ["dir", "Demo Director Kim Osei", "Direction"], ["pm", "Demo PM Jordan Hale", "Production"], ["cam1", "Demo Camera Op Ravi", "Camera"], ["cam2", "Demo Camera Op Bea", "Camera"], ["sound", "Demo Sound Recordist Max", "Sound"],
    ["gfx", "Demo Graphics Op Ines", "Graphics"], ["mua", "Demo Make-up Chloe", "Make-up"], ["actA", "Demo Actor Nadia", "Cast"], ["actB", "Demo Actor Leo", "Cast"], ["actC", "Demo Actor Grace", "Cast"],
    ["editor", "Demo Editor Felix", "Post"], ["dub", "Demo Dubbing Mixer Ola", "Post"], ["runner", "Demo Runner Ash", "Production"],
  ] as const) P[k] = (await C("people", { fullName: name, defaultDepartment: dept, email: `${k}@${DOMAIN}`, phone: "07700 900000", companyId: dept === "Cast" || dept === "Talent" ? agency.id : null })).id;

  const studio = await C("locations", { name: "Demo Studio 3", kind: "studio", status: "confirmed", address: "1 Demo Studios Way, Salford", postcode: "M50 0XX", parking: "Multi-storey level 2, show crew pass", nearestHospital: "Demo General Hospital A&E (2.1 miles)", accessNotes: "Stage door B; lanyards at reception", allowsSharedUse: false });
  const cafe = await C("locations", { name: "Demo Night Café", kind: "location", status: "confirmed", address: "22 Demo Street, Liverpool", postcode: "L1 0XX", parking: "Unit base in Demo Car Park (permit on file)", nearestHospital: "Demo Royal A&E (1.4 miles)" });
  const flat = await C("locations", { name: "Demo Flat Interior", kind: "location", status: "hold", address: "5 Demo Court, Liverpool", postcode: "L8 0XX" });
  const R: Record<string, string> = {};
  for (const [k, name, kind, qty] of [["camA", "Studio camera channel", "equipment", 4], ["jib", "Jib arm", "equipment", 1], ["buzzers", "Contestant buzzer set", "prop", 1], ["podiums", "Contestant podiums", "set", 4], ["mug", "Café mugs (hero)", "prop", 6], ["apron", "Waiter apron", "wardrobe", 2], ["alexa", "ALEXA Mini kit", "equipment", 1], ["dolly", "Dolly + track", "equipment", 1], ["radiomics", "Radio mics", "equipment", 8]] as const)
    R[k] = (await C("resources", { name, kind, quantity: qty, status: "available", supplierCompanyId: kind === "equipment" ? hire.id : null })).id;

  // ── Production 1: studio gameshow with episodes and running order ──
  const quiz = await C("productions", { title: "Demo: Brain Drain — Series 1", code: "BD1", kind: "gameshow", status: "production", usesEpisodes: true, ipProjectId: ipQuiz.id, startDate: "2027-03-01", endDate: "2027-05-31", baseLocation: "Demo Studio 3", businessUnitId: bu.id, legalEntityId: le.id });
  const quizEps: string[] = [];
  for (let n = 1; n <= 3; n++) quizEps.push((await C("episodes", { productionId: quiz.id, number: n, title: `Heat ${n}`, status: n === 1 ? "post" : "prep", deliveryDate: `2027-04-${10 + n}`, runningTimeMins: 45 })).id);
  const segs = [["0", "Cold open & titles", "titles", 5], ["1", "Round 1 — Fastest Finger", "round", 25], ["2", "Round 2 — Picture Board", "round", 25], ["3", "Ad break reset", "ad_break", 10], ["4", "Final — The Drain", "round", 30], ["5", "Winner & credits", "link", 5]] as const;
  const quizScenes: Record<string, string[]> = {};
  for (const [ei, ep] of quizEps.entries()) {
    quizScenes[ep] = [];
    for (const [i, [num, title, kind, mins]] of segs.entries()) {
      const s = await C("scenes", { productionId: quiz.id, episodeId: ep, number: num, title, kind, sortOrder: (i + 1) * 10, locationId: studio.id, intExt: "STUDIO", estDurationMins: mins, status: "ready", director: "Demo Director Kim Osei", cameraPlan: kind === "round" ? "4 peds + jib; ISO on each podium" : null, graphicsNotes: kind === "round" ? "Question set Q-" + (ei + 1) + num : null });
      quizScenes[ep].push(s.id);
      await linkScenePerson(admin, s.id, P.host, "host");
      if (kind === "round") { for (const c of ["c1", "c2", "c3", "c4"]) await linkScenePerson(admin, s.id, P[c], "contestant"); await linkSceneResource(admin, s.id, R.buzzers, 1); await linkSceneResource(admin, s.id, R.podiums, 4); }
      await linkScenePerson(admin, s.id, P.cam1, "crew"); await linkScenePerson(admin, s.id, P.gfx, "crew");
      await linkSceneResource(admin, s.id, R.camA, 4);
    }
  }
  await processOutbox({ orgId: org.id, limit: 500 }); // shot automation for scenes with name + director (each creates one master shot)
  const quizDay1 = await C("shoot_days", { productionId: quiz.id, date: "2027-03-10", dayNumber: 1, unit: "Studio", generalCall: "08:00", estWrap: "19:00", baseLocationId: studio.id, status: "confirmed", safetyNotes: "Audience fire exits briefed at 13:30." });
  for (const id of quizScenes[quizEps[0]]) await addSceneToDay(admin, quizDay1.id, id);
  await addBlock(admin, quizDay1.id, "meal", "Lunch", "13:00", "14:00");
  await C("catering_orders", { productionId: quiz.id, shootDayId: quizDay1.id, meal: "lunch", serveTime: "13:00", headcount: 42, supplierCompanyId: caterer.id, dietaryNotes: "6 vegetarian, 2 vegan, 1 coeliac" });
  const quizDay2 = await C("shoot_days", { productionId: quiz.id, date: "2027-03-11", dayNumber: 2, unit: "Studio", generalCall: "08:00", baseLocationId: studio.id });
  for (const id of quizScenes[quizEps[1]]) await addSceneToDay(admin, quizDay2.id, id);

  // ── Production 2: scripted pilot on location ──
  const drama = await C("productions", { title: "Demo: Night Shift — Pilot", code: "NS0", kind: "series", status: "pre_production", usesEpisodes: true, ipProjectId: ipDrama.id, startDate: "2027-03-08", businessUnitId: bu.id });
  const pilot = await C("episodes", { productionId: drama.id, number: 1, title: "Pilot", status: "prep" });
  const dramaScenes: string[] = [];
  const beats = ["Nadia opens the café", "Leo arrives late again", "The broken coffee machine", "Grace's mystery order", "Power cut", "Candlelit customers", "Leo's confession", "Morning shift handover", "Flat — Nadia can't sleep", "Flat — phone call", "Café — the inspector", "Final toast"];
  for (const [i, t] of beats.entries()) {
    const s = await C("scenes", { productionId: drama.id, episodeId: pilot.id, number: String(i + 1), title: t, kind: "scene", sortOrder: (i + 1) * 10, intExt: i >= 8 && i <= 9 ? "INT" : "INT", dayNight: i < 4 || i > 6 ? "NIGHT" : "NIGHT", locationId: i >= 8 && i <= 9 ? flat.id : cafe.id, pageEighths: 8 + (i % 5) * 4, estDurationMins: 60 + (i % 3) * 30, status: "ready" });
    dramaScenes.push(s.id);
    await linkScenePerson(admin, s.id, P.actA, "cast", "Nadia");
    if (i % 2 === 0) await linkScenePerson(admin, s.id, P.actB, "cast", "Leo");
    if (i === 3 || i === 10) await linkScenePerson(admin, s.id, P.actC, "cast", "Grace");
    await linkSceneResource(admin, s.id, R.alexa, 1);
    if (i < 8) await linkSceneResource(admin, s.id, R.mug, 2);
  }
  for (const [i, sid] of dramaScenes.slice(0, 3).entries()) await createEntity(admin, "shots", { productionId: drama.id, sceneId: sid, number: "1", shotType: "WS", movement: "dolly", description: `Establishing — ${beats[i]}`, priority: "must" });
  const dDay1 = await C("shoot_days", { productionId: drama.id, date: "2027-03-10", dayNumber: 1, unit: "Main Unit", generalCall: "16:00", estWrap: "04:00", baseLocationId: cafe.id, status: "confirmed", weatherNote: "Entered by PM: dry, 6°C" });
  for (const id of dramaScenes.slice(0, 4)) await addSceneToDay(admin, dDay1.id, id);
  for (const k of ["dir", "pm", "cam2", "sound", "mua", "runner"]) await upsertCall(admin, dDay1.id, P[k], { roleType: "crew", roleTitle: k === "dir" ? "Director" : k === "pm" ? "Production manager" : undefined });
  // A deliberate, visible conflict: the pilot also needs the studio camera channels the gameshow has booked on the same date.
  await linkSceneResource(admin, dramaScenes[0], R.camA, 2);
  await C("transport_bookings", { productionId: drama.id, shootDayId: dDay1.id, kind: "minibus", pickupTime: "15:00", pickupLocation: "Demo Hotel", dropoffLocation: "Demo Night Café", driver: "Demo Driver" });
  await C("availability_blocks", { personId: P.actC, startDate: "2027-03-12", endDate: "2027-03-14", kind: "unavailable", note: "Theatre matinee" });
  const dDay2 = await C("shoot_days", { productionId: drama.id, date: "2027-03-12", dayNumber: 2, unit: "Main Unit", generalCall: "16:00", baseLocationId: cafe.id });
  await addSceneToDay(admin, dDay2.id, dramaScenes[10]);

  // ── Production 3: standalone commercial (no episodes) ──
  const spot = await C("productions", { title: "Demo: Spring Snack Spot", code: "SPOT1", kind: "commercial", status: "development", usesEpisodes: false, businessUnitId: bu.id });
  for (const [i, t] of ["Hero pack reveal", "Family table moment", "End frame & legal"].entries()) await C("scenes", { productionId: spot.id, number: String(i + 1), title: t, kind: "segment", sortOrder: (i + 1) * 10, locationId: studio.id });

  // ── Engagements, contracts, releases ──
  for (const [p, kind, role, prod, rate] of [["host", "presenter", "Host", quiz.id, 150000], ["cam1", "crew", "Camera operator", quiz.id, 45000], ["gfx", "crew", "Graphics operator", quiz.id, 40000], ["actA", "cast", "Nadia", drama.id, 80000], ["actB", "cast", "Leo", drama.id, 70000], ["actC", "cast", "Grace", drama.id, 60000], ["dir", "crew", "Director", drama.id, 90000], ["cam2", "crew", "DoP", drama.id, 65000]] as const)
    await C("engagements", { productionId: prod, personId: P[p], kind, roleTitle: role, characterName: kind === "cast" ? role : null, status: "confirmed", rateMinor: rate, rateUnit: "day" });
  const hostContract = await C("contracts", { title: "Host agreement — Brain Drain S1", kind: "cast", productionId: quiz.id, counterpartyPersonId: P.host, legalEntityId: le.id, valueMinor: 1_800_000, startDate: "2027-03-01", endDate: "2027-05-31" });
  await C("contract_obligations", { contractId: hostContract.id, productionId: quiz.id, description: "Approve publicity stills within 5 working days", dueDate: "2027-04-01" });
  for (const c of ["c1", "c2", "c3"]) await C("release_forms", { productionId: quiz.id, personId: P[c], name: `Contestant release — ${c.toUpperCase()}`, kind: "appearance", status: "signed", signedAt: new Date("2027-02-20").toISOString() });
  await C("release_forms", { productionId: quiz.id, personId: P.c4, name: "Contestant release — C4", kind: "appearance", status: "sent" });

  // ── Money ──
  const budget = await C("budgets", { productionId: quiz.id, name: "Series 1 production budget", versionLabel: "v2" });
  const lines: Record<string, string> = {};
  for (const [i, [code, cat, est]] of ([["100", "Talent & presenters", 6_000_000], ["200", "Studio & facilities", 9_500_000], ["300", "Camera & technical", 4_200_000], ["400", "Graphics & software", 1_800_000], ["500", "Post-production", 3_600_000], ["600", "Catering & welfare", 900_000]] as const).entries())
    lines[code] = (await C("budget_lines", { productionId: quiz.id, budgetId: budget.id, code, category: cat, estimateMinor: est, vatRateBp: code === "100" ? 0 : 2000, sortOrder: (i + 1) * 10 })).id;
  await requestApproval(admin, "budgets", budget.id, "Series budget v2 for sign-off");
  const pending = await db.query.approvalRequests.findFirst({ where: (a, { eq: e }) => e(a.subjectId, budget.id) });
  await decideApproval(exec, pending!.id, "approved", "Approved at commissioning meeting (demo)");
  const po = await C("purchase_orders", { productionId: quiz.id, budgetLineId: lines["300"], supplierCompanyId: hire.id, number: "DEMO-PO-0001", description: "Studio camera channels — 3 weeks", netMinor: 2_400_000, vatMinor: 480_000 });
  await requestApproval(admin, "purchase_orders", po.id);
  await C("expenses", { productionId: quiz.id, budgetLineId: lines["600"], description: "Runner float — week 1", supplier: "Various", incurredOn: "2027-03-03", netMinor: 18_500, vatMinor: 0 });

  // ── Post & delivery ──
  const edit = await C("post_tasks", { productionId: quiz.id, episodeId: quizEps[0], kind: "edit", title: "Heat 1 offline edit", assigneePersonId: P.editor, status: "in_progress", dueDate: "2027-03-24" });
  await C("post_tasks", { productionId: quiz.id, episodeId: quizEps[0], kind: "sound", title: "Heat 1 dub", assigneePersonId: P.dub, status: "todo", dueDate: "2027-04-02" });
  await C("post_tasks", { productionId: quiz.id, episodeId: quizEps[0], kind: "graphics", title: "Heat 1 graphics pass", assigneePersonId: P.gfx, status: "review", dueDate: "2027-03-28" });
  const cut = await C("edit_versions", { productionId: quiz.id, episodeId: quizEps[0], postTaskId: edit.id, versionLabel: "v1", kind: "rough_cut", reviewUrl: "https://review.example.test/demo-heat1-v1" });
  await C("review_comments", { productionId: quiz.id, editVersionId: cut.id, timecode: "00:04:12:00", body: "Tighten the Round 1 intro — lose the second wide." });
  await C("deliverables", { productionId: quiz.id, episodeId: quizEps[0], title: "Heat 1 — ProRes 422 HQ master + stems", spec: "1080i50, EBU R128", destinationCompanyId: broadcaster.id, dueDate: "2027-04-11" });
  await C("rights_entries", { title: "Brain Drain format rights", rightType: "format", ipProjectId: ipQuiz.id, status: "cleared", grantor: "Demo Format Owner", territories: "Worldwide", media: "All media" });
  await C("rights_entries", { title: "Theme music licence", rightType: "music", productionId: quiz.id, status: "pending", grantor: "Demo Music Library", restrictions: "UK TX + 2 repeats" });
  await C("releases", { productionId: quiz.id, episodeId: quizEps[0], channelCompanyId: broadcaster.id, platform: "Saturday 19:00", territory: "UK", releaseDate: "2027-05-01", status: "planned" });

  // ── Commercial ──
  const deal = await C("sponsor_deals", { title: "Demo Snacks — series sponsorship", kind: "sponsorship", companyId: brand.id, productionId: quiz.id, stage: "contracted", valueMinor: 7_500_000, startDate: "2027-05-01", obligations: "Bumpers on every break; on-set product in Round 2" });
  await C("commercial_deliverables", { sponsorDealId: deal.id, productionId: quiz.id, episodeId: quizEps[0], description: "Sponsor bumpers ×4 (Heat 1)", dueDate: "2027-04-20" });
  await C("sales_opportunities", { title: "Format sale — Nordics", ipProjectId: ipQuiz.id, buyerCompanyId: broadcaster.id, territory: "Nordics", rightsType: "Format", stage: "negotiating", valueMinor: 12_000_000, probabilityPct: 40, expectedClose: "2027-06-30" });

  // ── Operations & governance ──
  await C("tasks", { title: "Confirm audience warm-up act", productionId: quiz.id, status: "todo", priority: "high", dueDate: "2027-03-05", assigneeUserId: admin.userId });
  await C("tasks", { title: "Chase C4 release form", productionId: quiz.id, status: "doing", priority: "urgent", dueDate: "2027-03-08" });
  await C("sops", { title: "Call sheet issue & distribution", category: "Production", status: "approved", body: "1. Resolve blocking conflicts. 2. Issue new version. 3. Prepare distribution. 4. Confirm sends in Outbox." });
  await C("risks", { title: "Studio overrun on Heat 1 record", category: "schedule", likelihood: 3, impact: 4, status: "open", productionId: quiz.id, mitigation: "Pre-record cold open; hard out agreed with studio." });
  for (const [name, key] of [["Active productions", "active_productions"], ["Pending approvals", "pending_approvals"], ["Deliverables due in 14 days", "deliverables_due_14d"]] as const) await C("kpis", { name, metricKey: key, definition: "Live metric computed from the database." });

  // ── Density fixture: mirrors legacy volumes (79 scenes / 70 shots) for performance & UX testing ──
  const fx = await C("productions", { title: "Demo fixture: 79-scene density test", code: "FX79", kind: "series", status: "pre_production", usesEpisodes: true, description: "Synthetic fixture with the same volumes as the legacy S'appening snapshot (4 episodes, 79 scenes, 70 shots). Not source data." });
  let shotCount = 0;
  for (let e = 1; e <= 4; e++) {
    const ep = await C("episodes", { productionId: fx.id, number: e, title: `Fixture episode ${e}` });
    const n = e < 4 ? 20 : 19;
    for (let i = 1; i <= n; i++) {
      const s = await C("scenes", { productionId: fx.id, episodeId: ep.id, number: String(i), title: `Fixture scene ${e}.${i}`, kind: "scene", sortOrder: i * 10, intExt: i % 3 ? "INT" : "EXT", dayNight: i % 4 ? "DAY" : "NIGHT", locationId: i % 2 ? cafe.id : flat.id, estDurationMins: 30 + (i % 4) * 15, status: i % 5 === 0 ? "ready" : "draft" });
      if (shotCount < 70 && i % 9 !== 0) { await createEntity(admin, "shots", { productionId: fx.id, sceneId: s.id, number: "1", shotType: "MS", description: `Fixture shot for ${e}.${i}`, priority: "should" }); shotCount++; }
    }
  }

  // ── Role accounts (production-scoped) ──
  await createUserWithMembership({ orgId: org.id, role: "producer", email: `producer@${DOMAIN}`, name: "Demo Producer", password, productionIds: [quiz.id, drama.id, spot.id, fx.id] });
  const pmUser = await createUserWithMembership({ orgId: org.id, role: "production_manager", email: `production-manager@${DOMAIN}`, name: "Demo Production Manager", password, productionIds: [quiz.id, drama.id], personId: P.pm });
  await createUserWithMembership({ orgId: org.id, role: "department_head", email: `department-head@${DOMAIN}`, name: "Demo Head of Camera", password, productionIds: [drama.id] });
  await createUserWithMembership({ orgId: org.id, role: "crew", email: `crew@${DOMAIN}`, name: "Demo Camera Op Bea", password, productionIds: [drama.id], personId: P.cam2 });
  await createUserWithMembership({ orgId: org.id, role: "cast", email: `cast@${DOMAIN}`, name: "Demo Actor Nadia", password, productionIds: [drama.id], personId: P.actA });
  await createUserWithMembership({ orgId: org.id, role: "finance_legal", email: `finance-legal@${DOMAIN}`, name: "Demo Finance & Legal", password });
  await createUserWithMembership({ orgId: org.id, role: "post", email: `post@${DOMAIN}`, name: "Demo Post Supervisor", password, productionIds: [quiz.id] });
  await createUserWithMembership({ orgId: org.id, role: "commercial", email: `commercial@${DOMAIN}`, name: "Demo Commercial Lead", password });
  await createUserWithMembership({ orgId: org.id, role: "external_reviewer", email: `external-reviewer@${DOMAIN}`, name: "Demo Broadcaster Reviewer", password, productionIds: [quiz.id] });
  void pmUser; void gate; void updateEntity;
  await processOutbox({ orgId: org.id, limit: 1000 });

  // Customisation examples (all editable under Customise / Automations).
  const { updateSettings, createFieldDef } = await import("@/server/services/customise");
  const { createRule } = await import("@/server/workflows/rules");
  await updateSettings(admin, { options: { "scenes.kind": ["Challenge", "Audience interaction"] }, departments: ["Production", "Camera", "Sound", "Graphics", "Post", "Talent"] });
  admin.settings = { ...admin.settings, options: { "scenes.kind": ["challenge", "audience_interaction"] } };
  await createFieldDef(admin, { entity: "scenes", label: "Graphics cue ID", type: "text", help: "Reference in the gallery's graphics system" });
  await createFieldDef(admin, { entity: "deliverables", label: "Broadcaster spec version", type: "select", options: ["v1", "v2", "v3"] });
  await createRule(admin, { name: "Chase rejected deliverables", entity: "deliverables", event: "updated", field: "status", value: "rejected", action: { type: "create_task", title: "Fix QC notes: {{title}}", priority: "urgent", dueInDays: 1 } });
  return { orgId: org.id, created: true, password };
}
