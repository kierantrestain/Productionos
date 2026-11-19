/**
 * Source table → canonical entity mappings. Candidate field names are matched
 * case/punctuation-insensitively against each table's exported schema.
 * Specs run in array order, so parents (episodes, people, resources, IP) precede children.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import * as s from "@/db/schema";
import type { Rec } from "./record";

export type ExceptionKind = "orphan_link" | "unmapped_field" | "validation" | "attachment_failed" | "reconciliation";
export interface ImportCtx {
  tx: Tx;
  orgId: string;
  map: Map<string, { type: string; id: string }>;
  legacyProductionId(): Promise<string>;
  exception(kind: ExceptionKind, tableId: string, recordId: string | null, detail: string): void;
  editing: { matched: number; matchedByLink: number; matchedByNumber: number; unmatched: number };
}
export interface Built { values: Record<string, unknown> }
export interface Spec {
  base: "Ovation_OS" | "Sappening_Production";
  table: string;
  target: string;
  pg: any;
  build(r: Rec, c: ImportCtx): Promise<Built | null>;
  /** Runs after the target row exists (create, update or unchanged) — secondary rows that need the target id. */
  after?(r: Rec, c: ImportCtx, targetId: string): Promise<void>;
  /** Pass 2: many-to-many links, after every table has been created. */
  links?(r: Rec, c: ImportCtx, targetId: string): Promise<void>;
}

function intExt(v: string | null) {
  const u = (v ?? "").toUpperCase().replace(/\s+/g, "");
  if (["INT", "EXT", "INT/EXT", "STUDIO"].includes(u)) return u;
  if (u.startsWith("INT/") || u === "I/E") return "INT/EXT";
  return u.startsWith("INT") ? "INT" : u.startsWith("EXT") ? "EXT" : null;
}
const NOTES = ["Notes", "Note", "Comments", "Description"];
const STATUS = ["Status", "Stage", "State"];

/** Resolve linked record ids to target ids; unresolved → orphan_link exception. */
function ref(c: ImportCtx, r: Rec, ids: string[], type: string | string[], label: string): string | null {
  const types = Array.isArray(type) ? type : [type];
  let first: string | null = null;
  for (const id of ids) {
    const t = c.map.get(id);
    if (t && types.includes(t.type)) { first ??= t.id; continue; }
    if (!t) c.exception("orphan_link", r.table.id, r.id, `${label}: linked record ${id} not found in export`);
  }
  return first;
}
function refs(c: ImportCtx, r: Rec, ids: string[], type: string | string[], label: string): string[] {
  const types = Array.isArray(type) ? type : [type];
  const out: string[] = [];
  for (const id of ids) {
    const t = c.map.get(id);
    if (t && types.includes(t.type)) out.push(t.id);
    else if (!t) c.exception("orphan_link", r.table.id, r.id, `${label}: linked record ${id} not found in export`);
  }
  return out;
}

async function companyByName(c: ImportCtx, name: string, kind: string) {
  const [ex] = await c.tx.select({ id: s.companies.id }).from(s.companies).where(and(eq(s.companies.orgId, c.orgId), eq(s.companies.name, name), isNull(s.companies.archivedAt))).limit(1);
  if (ex) return ex.id;
  const [row] = await c.tx.insert(s.companies).values({ orgId: c.orgId, name, kind, notes: "Created by Airtable import" }).returning({ id: s.companies.id });
  return row.id;
}

async function upsertEngagement(c: ImportCtx, personId: string, kind: "cast" | "crew", r: Rec) {
  const productionId = await c.legacyProductionId();
  const contract = r.s(["Contract Status", "Cast Contract Status", "Contract"]);
  const k = (contract ?? "").toLowerCase();
  // Imported statuses never trigger generation/sending; "Create Contract" is recorded as a draft.
  const contractStatus = k.includes("sign") ? "signed" : k.includes("sent") ? "sent" : k.includes("generat") ? "generated" : k ? "draft" : "none";
  const values = {
    roleTitle: r.s(kind === "cast" ? ["Role", "Character", "Character Name", "Part"] : ["Role", "Job Title", "Position", "Department Role"], 500),
    characterName: kind === "cast" ? r.s(["Character", "Character Name", "Part"], 500) : null,
    department: r.s(["Department", "Dept"], 500),
    status: "confirmed",
    rateMinor: r.m(["Rate", "Day Rate", "Fee", "Daily Rate"]),
    rateUnit: r.raw(["Day Rate", "Daily Rate"]) !== undefined ? "day" : null,
    contractStatus,
    detailsEmailSentAt: r.b(["Email Sent", "Details Sent", "Cast Details Sent"]) ? new Date(r.rec.createdTime ?? Date.now()) : null,
  };
  if (contractStatus === "signed") c.exception("validation", r.table.id, r.id, "Source contract status is Signed; signature evidence not verified — review before relying on it");
  const [ex] = await c.tx.select({ id: s.engagements.id }).from(s.engagements)
    .where(and(eq(s.engagements.productionId, productionId), eq(s.engagements.personId, personId), eq(s.engagements.kind, kind), isNull(s.engagements.archivedAt))).limit(1);
  if (ex) await c.tx.update(s.engagements).set({ ...values, updatedAt: new Date() }).where(eq(s.engagements.id, ex.id));
  else await c.tx.insert(s.engagements).values({ ...values, orgId: c.orgId, productionId, personId, kind });
}

const personFields = (r: Rec) => ({
  fullName: r.s(["Full Name", "Name", "Actor", "Cast Name", "Crew Name", "Person"], 500) ?? "Unnamed person",
  preferredName: r.s(["Preferred Name", "Known As"], 500),
  pronouns: r.s(["Pronouns"], 100),
  email: r.s(["Email", "Email Address", "E-mail"], 320),
  phone: r.s(["Phone", "Phone Number", "Mobile", "Contact Number"], 100),
  address: r.s(["Address", "Home Address"]),
  agentName: r.s(["Agent", "Agency", "Agent Name"], 500),
  agentEmail: r.s(["Agent Email"], 320),
  defaultDepartment: r.s(["Department", "Dept"], 200),
  dietary: r.s(["Dietary", "Dietary Requirements", "Allergies"], 500),
  emergencyContact: r.s(["Emergency Contact"], 500),
  notes: r.s(NOTES),
});

function resourceSpec(table: string, kind: "prop" | "wardrobe" | "equipment"): Spec {
  return {
    base: "Sappening_Production", table, target: "resources", pg: s.resources,
    async build(r, c) {
      return { values: {
        kind, productionId: await c.legacyProductionId(),
        name: r.s(["Name", "Item", "Item Name", `${table} Name`, "Prop", "Costume", "Equipment"], 500) ?? `Unnamed ${kind}`,
        category: r.s(["Category", "Type"], 200),
        quantity: Math.max(r.i(["Quantity", "Qty", "Count"]) ?? 1, 1),
        characterName: kind === "wardrobe" ? r.s(["Character", "Worn By"], 500) : null,
        size: r.s(["Size"], 100),
        serialNumber: r.s(["Serial", "Serial Number", "Asset Tag"], 200),
        dailyRateMinor: r.m(["Daily Rate", "Hire Cost", "Cost", "Price"]),
        status: r.sel(STATUS, ["available", "booked", "checked_out", "maintenance", "lost", "retired"] as const, "available", { sourced: "available", ready: "available", hired: "booked", needed: "available" }),
        notes: r.s(NOTES),
      } };
    },
  };
}

// ─────────────────────────────── S'appening ───────────────────────────────

const SAP: Spec[] = [
  {
    base: "Sappening_Production", table: "Episodes", target: "episodes", pg: s.episodes,
    async build(r, c) {
      const number = r.i(["Episode Number", "Episode No", "Episode #", "Number", "No"]);
      const synopsis = r.s(["Synopsis", "Summary", "Logline", "Description"]);
      return { values: {
        productionId: await c.legacyProductionId(), number,
        title: r.s(["Episode Title", "Title", "Episode Name", "Name", "Episode"], 500) ?? (number != null ? `Episode ${number}` : "Untitled episode"),
        status: r.sel(STATUS, ["development", "scripting", "prep", "shooting", "post", "delivered", "transmitted"] as const, "development", { pre: "prep", film: "shooting", edit: "post", complete: "delivered" }),
        synopsis, synopsisOriginal: synopsis,
        shootStart: r.d(["Shoot Start", "Shoot Date", "Filming Start"]), shootEnd: r.d(["Shoot End", "Filming End"]),
        deliveryDate: r.d(["Delivery Date", "Delivery"]), txDate: r.d(["TX Date", "Release Date", "Air Date"]),
        runningTimeMins: r.i(["Running Time", "Duration", "Runtime"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Locations", target: "locations", pg: s.locations,
    async build(r) {
      return { values: {
        name: r.s(["Location Name", "Name", "Location"], 500) ?? "Unnamed location",
        kind: r.sel(["Type", "Kind"], ["location", "studio", "stage", "facility", "unit_base"] as const, "location"),
        address: r.s(["Address", "Full Address"]), postcode: r.s(["Postcode", "Post Code", "Zip"], 20),
        what3words: r.s(["what3words", "W3W"], 200), contactName: r.s(["Contact", "Contact Name", "Owner"], 500), contactPhone: r.s(["Contact Phone", "Phone"], 100),
        parking: r.s(["Parking"]), accessNotes: r.s(["Access", "Access Notes"]), nearestHospital: r.s(["Nearest Hospital", "Hospital", "Nearest A&E"], 500),
        status: r.sel(STATUS, ["scouted", "hold", "confirmed", "cleared", "unavailable"] as const, "scouted", { booked: "confirmed", approved: "cleared", pending: "hold", option: "hold" }),
        permitRequired: r.b(["Permit Required", "Permit"]) ?? false,
        dailyCostMinor: r.m(["Cost", "Daily Cost", "Fee", "Location Fee"]), notes: r.s(NOTES),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Cast", target: "people", pg: s.people,
    async build(r) { return { values: personFields(r) }; },
    async after(r, c, id) { await upsertEngagement(c, id, "cast", r); },
  },
  {
    base: "Sappening_Production", table: "Crew", target: "people", pg: s.people,
    async build(r) { return { values: personFields(r) }; },
    async after(r, c, id) { await upsertEngagement(c, id, "crew", r); },
  },
  resourceSpec("Props", "prop"), resourceSpec("Wardrobe", "wardrobe"), resourceSpec("Equipment", "equipment"),
  {
    base: "Sappening_Production", table: "Scenes", target: "scenes", pg: s.scenes,
    async build(r, c) {
      const productionId = await c.legacyProductionId();
      const episodeId = ref(c, r, r.links(["Episode", "Episodes"]), "episodes", "Episode");
      let number = r.s(["Scene Number", "Scene No", "Scene #", "Scene", "Number"], 50) ?? `S-${r.id.slice(-6)}`;
      // Scene numbers are unique per episode; a duplicate in the source is kept but suffixed and flagged.
      const self = c.map.get(r.id)?.id;
      const clash = await c.tx.select({ id: s.scenes.id }).from(s.scenes).where(and(eq(s.scenes.productionId, productionId), eq(s.scenes.number, number), isNull(s.scenes.archivedAt), episodeId ? eq(s.scenes.episodeId, episodeId) : isNull(s.scenes.episodeId))).limit(2);
      if (clash.some((x) => x.id !== self)) {
        c.exception("validation", r.table.id, r.id, `Duplicate scene number "${number}" in the same episode; imported as "${number}-${r.id.slice(-4)}"`);
        number = `${number}-${r.id.slice(-4)}`;
      }
      return { values: {
        productionId, episodeId, number,
        title: r.s(["Scene Name", "Scene Title", "Title", "Heading", "Name"], 500) ?? "Untitled scene",
        sortOrder: r.i(["Order", "Running Order", "Sort"]) ?? (parseInt(r.s(["Scene Number", "Scene No", "Scene #", "Number"]) ?? "", 10) || 0) * 10,
        intExt: intExt(r.s(["INT/EXT", "Int/Ext", "Interior/Exterior"], 20)),
        dayNight: (r.s(["Day/Night", "D/N", "Time of Day"], 20) ?? "").toUpperCase() || null,
        locationId: ref(c, r, r.links(["Location", "Locations"]), "locations", "Location"),
        description: r.s(["Description", "Action", "Scene Description", "Synopsis"]),
        director: r.s(["Director"], 500), directorNotes: r.s(["Director Notes", "Director's Notes"]),
        scriptRevisionRef: r.s(["Script Revision", "Script Version", "Draft"], 200),
        pageEighths: r.i(["Pages (1/8ths)", "Eighths", "Page Count"]), estDurationMins: r.i(["Duration", "Estimated Duration", "Est Duration", "Est. Mins"]),
        status: r.sel(STATUS, ["draft", "ready", "scheduled", "shot", "in_post", "complete", "omitted"] as const, "draft", { filmed: "shot", done: "complete", cut: "omitted", planned: "ready", to_shoot: "ready" }),
        specialRequirements: r.s(["Special Requirements", "Requirements", "SFX", "Stunts"]),
        cameraPlan: r.s(["Camera Plan", "Cameras"]), graphicsNotes: r.s(["Graphics", "Graphics Notes"]), audioNotes: r.s(["Audio", "Sound Notes"]),
      } };
    },
    async links(r, c, sceneId) {
      const add = async (ids: string[], roleType: string) => {
        for (const personId of refs(c, r, ids, "people", roleType)) await c.tx.insert(s.scenePeople).values({ orgId: c.orgId, sceneId, personId, roleType }).onConflictDoNothing();
      };
      await add(r.links(["Cast", "Cast Members", "Actors"]), "cast");
      await add(r.links(["Crew", "Crew Members"]), "crew");
      for (const f of [["Props"], ["Wardrobe", "Costumes"], ["Equipment", "Kit"]]) {
        for (const resourceId of refs(c, r, r.links(f), "resources", f[0])) await c.tx.insert(s.sceneResources).values({ orgId: c.orgId, sceneId, resourceId }).onConflictDoNothing();
      }
    },
  },
  {
    base: "Sappening_Production", table: "Shot List", target: "shots", pg: s.shots,
    async build(r, c) {
      const sceneId = ref(c, r, r.links(["Scene", "Scenes", "Scene Link"]), "scenes", "Scene");
      if (!sceneId) { c.exception("orphan_link", r.table.id, r.id, "Shot has no resolvable scene; not imported (shots require a scene)"); return null; }
      return { values: {
        productionId: await c.legacyProductionId(), sceneId,
        number: r.s(["Shot Number", "Shot No", "Shot #", "Shot", "Number"], 50) ?? r.id.slice(-6),
        sortOrder: (r.i(["Shot Number", "Order"]) ?? 0) * 10,
        description: r.s(["Description", "Shot Description", "Action"]),
        shotType: r.s(["Shot Type", "Type", "Size"], 50), framing: r.s(["Framing", "Composition"], 200),
        movement: r.s(["Movement", "Camera Movement"], 100), lens: r.s(["Lens"], 100), camera: r.s(["Camera"], 100),
        priority: r.sel(["Priority"], ["must", "should", "nice"] as const, "must", { high: "must", medium: "should", low: "nice" }),
        estMinutes: r.i(["Duration", "Est Minutes", "Estimated Time"]),
        status: r.sel(STATUS, ["planned", "shot", "omitted"] as const, "planned", { done: "shot", filmed: "shot", complete: "shot", cut: "omitted" }),
        notes: r.s(["Notes", "Director Notes"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Shoot Days", target: "shoot_days", pg: s.shootDays,
    async build(r, c) {
      const date = r.d(["Date", "Shoot Date", "Day"]);
      if (!date) { c.exception("validation", r.table.id, r.id, "Shoot day has no date; kept in lineage only"); return null; }
      return { values: {
        productionId: await c.legacyProductionId(), date, dayNumber: r.i(["Day Number", "Day #", "Shoot Day"]),
        unit: r.s(["Unit"], 100) ?? "Main Unit",
        status: r.sel(STATUS, ["planned", "confirmed", "wrapped", "cancelled"] as const, "planned", { done: "wrapped", complete: "wrapped", booked: "confirmed" }),
        generalCall: r.t(["Call Time", "General Call", "Unit Call"]), estWrap: r.t(["Wrap", "Wrap Time", "Est Wrap"]),
        baseLocationId: ref(c, r, r.links(["Unit Base", "Base Location"]), "locations", "Unit base"),
        weatherNote: r.s(["Weather"], 500), safetyNotes: r.s(["Health & Safety", "Safety", "Risk Assessment"]), notes: r.s(NOTES),
      } };
    },
    async links(r, c, dayId) {
      const sceneIds = refs(c, r, r.links(["Scenes", "Scene", "Scenes Scheduled"]), "scenes", "Scenes");
      const existing = await c.tx.select({ sceneId: s.scheduleBlocks.sceneId }).from(s.scheduleBlocks).where(eq(s.scheduleBlocks.shootDayId, dayId));
      const have = new Set(existing.map((e) => e.sceneId));
      const productionId = await c.legacyProductionId();
      let order = existing.length * 10;
      for (const sceneId of sceneIds) {
        if (have.has(sceneId)) continue;
        order += 10;
        await c.tx.insert(s.scheduleBlocks).values({ orgId: c.orgId, productionId, shootDayId: dayId, kind: "scene", sceneId, sortOrder: order, notes: "Imported from Airtable (no times in source link)" });
      }
      // Location links on the day are informational: they resolve but do not create blocks.
      refs(c, r, r.links(["Locations", "Location"]), "locations", "Locations");
    },
  },
  {
    base: "Sappening_Production", table: "Release Forms", target: "release_forms", pg: s.releaseForms,
    async build(r, c) {
      const personId = ref(c, r, r.links(["Cast", "Person", "Contributor", "Crew"]), "people", "Person");
      const status = r.sel(STATUS, ["required", "sent", "signed", "refused", "missing"] as const, "required", { complete: "signed", received: "signed", pending: "sent" });
      return { values: {
        productionId: await c.legacyProductionId(), personId,
        sceneId: ref(c, r, r.links(["Scene", "Scenes"]), "scenes", "Scene"),
        name: r.s(["Name", "Release Name", "Title"], 500) ?? "Release form",
        kind: r.sel(["Type", "Release Type"], ["appearance", "location", "minor", "materials", "music"] as const, "appearance"),
        status, signedAt: status === "signed" ? (r.d(["Signed Date", "Date Signed", "Date"]) ? new Date(`${r.d(["Signed Date", "Date Signed", "Date"])}T12:00:00Z`) : null) : null,
        notes: r.s(NOTES),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Contracts", target: "contracts", pg: s.contracts,
    async build(r, c) {
      const status = r.sel(STATUS, ["draft", "generated", "approved", "sent", "signed", "countersigned", "expired", "terminated", "blocked"] as const, "draft", { create_contract: "draft", complete: "signed", executed: "signed" });
      if (status === "signed" || status === "countersigned") c.exception("validation", r.table.id, r.id, "Contract imported with Signed status but no verified signature evidence; review");
      return { values: {
        productionId: await c.legacyProductionId(), kind: r.sel(["Type", "Contract Type"], ["cast", "crew", "location", "licence", "sponsorship", "distribution", "chain_of_title", "nda", "services", "other"] as const, "other"),
        title: r.s(["Title", "Name", "Contract Name"], 500) ?? "Imported contract", status,
        counterpartyPersonId: ref(c, r, r.links(["Cast", "Crew", "Person", "Party"]), "people", "Counterparty"),
        valueMinor: r.m(["Value", "Fee", "Amount"]), startDate: r.d(["Start Date", "Start"]), endDate: r.d(["End Date", "End"]),
        notes: [r.s(NOTES), status === "signed" ? "Status imported from Airtable — signature evidence not verified." : null].filter(Boolean).join("\n") || null,
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Expenses", target: "expenses", pg: s.expenses,
    async build(r, c) {
      const gross = r.m(["Amount", "Total", "Cost", "Gross"]);
      const vat = r.m(["VAT"]) ?? 0;
      const net = r.m(["Net", "Net Amount"]) ?? (gross != null ? Math.max(gross - vat, 0) : null);
      if (net == null) { c.exception("validation", r.table.id, r.id, "Expense has no amount; kept in lineage only"); return null; }
      return { values: {
        productionId: await c.legacyProductionId(), description: r.s(["Description", "Item", "Name", "Expense"], 500) ?? "Imported expense",
        supplier: r.s(["Supplier", "Vendor", "Payee"], 500), incurredOn: r.d(["Date", "Expense Date"]),
        netMinor: net, vatMinor: vat,
        status: r.sel(STATUS, ["draft", "submitted", "approved", "rejected", "paid"] as const, "submitted", { reimbursed: "paid", pending: "submitted" }),
      } };
    },
  },
  ...(["Sponsors", "Partnerships", "Marketing"] as const).map((table): Spec => ({
    base: "Sappening_Production", table, target: "sponsor_deals", pg: s.sponsorDeals,
    async build(r, c) {
      const brand = r.s(["Company", "Brand", "Sponsor", "Partner", "Company Name"], 500);
      const name = r.s(["Name", "Title", "Deal", "Campaign"], 500);
      return { values: {
        productionId: await c.legacyProductionId(),
        title: name ?? brand ?? `Imported ${table.toLowerCase()} record`,
        kind: table === "Sponsors" ? "sponsorship" : table === "Partnerships" ? "partnership" : "marketing",
        companyId: table !== "Marketing" && (brand ?? name) ? await companyByName(c, (brand ?? name)!, table === "Sponsors" ? "sponsor" : "partner") : null,
        valueMinor: r.m(["Value", "Amount", "Fee", "Budget"]),
        stage: r.sel(STATUS, ["lead", "negotiating", "contracted", "delivering", "complete", "lost"] as const, "lead", { confirmed: "contracted", signed: "contracted", active: "delivering", done: "complete" }),
        startDate: r.d(["Start Date", "Start", "Date"]), endDate: r.d(["End Date", "End"]),
        obligations: r.s(["Obligations", "Deliverables", "Notes", "Description"]),
      } };
    },
  })),
  {
    base: "Sappening_Production", table: "Tasks", target: "tasks", pg: s.tasks,
    async build(r, c) {
      return { values: {
        productionId: await c.legacyProductionId(), title: r.s(["Task", "Name", "Title"], 500) ?? "Imported task",
        status: r.sel(STATUS, ["todo", "doing", "blocked", "done"] as const, "todo", { in_progress: "doing", complete: "done", not_started: "todo" }),
        priority: r.sel(["Priority"], ["low", "normal", "high", "urgent"] as const, "normal"),
        dueDate: r.d(["Due", "Due Date", "Deadline"]), description: r.s(["Description", "Notes"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Catering", target: "catering_orders", pg: s.cateringOrders,
    async build(r, c) {
      return { values: {
        productionId: await c.legacyProductionId(), shootDayId: ref(c, r, r.links(["Shoot Day", "Shoot Days", "Date"]), "shoot_days", "Shoot day"),
        meal: r.sel(["Meal", "Type"], ["breakfast", "lunch", "dinner", "running_buffet", "snacks"] as const, "lunch"),
        serveTime: r.t(["Time", "Serve Time"]), headcount: r.i(["Headcount", "Numbers", "Quantity"]),
        dietaryNotes: r.s(["Dietary", "Dietary Requirements"]), costMinor: r.m(["Cost", "Amount"]), notes: r.s(["Notes", "Supplier", "Caterer", "Name"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Transport", target: "transport_bookings", pg: s.transportBookings,
    async build(r, c) {
      return { values: {
        productionId: await c.legacyProductionId(), shootDayId: ref(c, r, r.links(["Shoot Day", "Shoot Days", "Date"]), "shoot_days", "Shoot day"),
        kind: r.sel(["Vehicle Type", "Type", "Vehicle"], ["car", "minibus", "coach", "van", "truck", "taxi", "train", "flight"] as const, "minibus"),
        pickupTime: r.t(["Pickup Time", "Pick Up", "Time"]), pickupLocation: r.s(["Pickup Location", "From", "Pick Up Location"], 500),
        dropoffLocation: r.s(["Dropoff", "To", "Destination"], 500), driver: r.s(["Driver"], 500), vehicle: r.s(["Registration", "Vehicle Reg"], 200),
        passengers: r.s(["Passengers"]), costMinor: r.m(["Cost", "Amount"]), notes: r.s(["Notes", "Name", "Description"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Post Production", target: "post_tasks", pg: s.postTasks,
    async build(r, c) {
      return { values: {
        productionId: await c.legacyProductionId(), title: r.s(["Task", "Name", "Title"], 500) ?? "Post-production item",
        kind: r.sel(["Type", "Stage"], ["ingest", "edit", "assembly", "offline", "online", "grade", "sound", "music", "graphics", "vfx", "subtitles", "qc", "delivery"] as const, "edit", { colour: "grade", color: "grade", mix: "sound" }),
        episodeId: ref(c, r, r.links(["Episode", "Episodes"]), "episodes", "Episode"),
        status: r.sel(STATUS, ["todo", "in_progress", "review", "done", "blocked"] as const, "todo", { complete: "done", not_started: "todo" }),
        dueDate: r.d(["Due", "Due Date", "Deadline"]), notes: r.s(["Notes", "Description"]),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Distribution", target: "releases", pg: s.releases,
    async build(r, c) {
      return { values: {
        productionId: await c.legacyProductionId(), episodeId: ref(c, r, r.links(["Episode", "Episodes"]), "episodes", "Episode"),
        platform: r.s(["Platform", "Channel", "Name", "Outlet"], 500), territory: r.s(["Territory", "Region"], 200),
        releaseDate: r.d(["Release Date", "Date", "Launch Date"]),
        status: r.sel(STATUS, ["planned", "scheduled", "released", "cancelled"] as const, "planned", { live: "released", published: "released" }),
        notes: r.s(NOTES),
      } };
    },
  },
  {
    base: "Sappening_Production", table: "Editing", target: "post_tasks", pg: s.postTasks,
    /** Editing rows are post work on existing scenes — reconciled, never turned into scenes. */
    async build(r, c) {
      const productionId = await c.legacyProductionId();
      const episodeId = ref(c, r, r.links(["Episode", "Episodes"]), "episodes", "Episode");
      const number = r.s(["Scene Number", "Scene No", "Scene #", "Number"], 50);
      let sceneId = ref(c, r, r.links(["Scene", "Scenes", "Linked Scene", "Scene Link"]), "scenes", "Scene");
      if (sceneId) { c.editing.matched++; c.editing.matchedByLink++; }
      else if (number) {
        const conds = [eq(s.scenes.productionId, productionId), eq(s.scenes.number, number), isNull(s.scenes.archivedAt)];
        conds.push(episodeId ? eq(s.scenes.episodeId, episodeId) : isNull(s.scenes.episodeId));
        const hits = await c.tx.select({ id: s.scenes.id }).from(s.scenes).where(and(...conds)).limit(2);
        if (hits.length === 1) { sceneId = hits[0].id; c.editing.matched++; c.editing.matchedByNumber++; }
      }
      if (!sceneId) { c.editing.unmatched++; c.exception("reconciliation", r.table.id, r.id, `Editing record could not be matched to a Scenes record (scene number: ${number ?? "none"}); imported as an unlinked post task`); }
      const sceneTitle = r.s(["Scene Name", "Scene Title", "Title", "Name"], 300);
      // Copied scene-breakdown fields (cast, crew, props, location, director…) are consumed here so they
      // are not reported as unmapped: the canonical values live on the matched scene.
      r.raw(["Cast", "Crew", "Props", "Wardrobe", "Equipment", "Location", "Locations", "Director", "Shot List", "Shots", "Description", "INT/EXT", "Day/Night"]);
      return { values: {
        productionId, episodeId, sceneId, kind: "edit",
        title: `Edit — Sc ${number ?? "?"}${sceneTitle ? ` ${sceneTitle}` : ""}`.slice(0, 500),
        status: r.sel(["Edit Status", "Editing Status", "Status"], ["todo", "in_progress", "review", "done", "blocked"] as const, "todo", { complete: "done", edited: "done", rough_cut: "in_progress", not_started: "todo", editing: "in_progress" }),
        dueDate: r.d(["Due", "Due Date", "Edit Due"]), notes: r.s(["Edit Notes", "Editor Notes", "Notes"]),
      } };
    },
  },
];

// ─────────────────────────────── Ovation ───────────────────────────────

const ipChild = (c: ImportCtx, r: Rec, label = "Slate & IP") => ref(c, r, r.links(["Slate & IP", "IP", "Project", "Show", "Slate", "IP Project"]), "ip_projects", label);

const OVA: Spec[] = [
  {
    base: "Ovation_OS", table: "Business Units & P&L", target: "business_units", pg: s.businessUnits,
    async build(r) { return { values: { name: r.s(["Business Unit", "Name", "Unit"], 500) ?? "Imported business unit", code: r.s(["Code"], 50), description: r.s(NOTES), revenueTargetMinor: r.m(["Revenue Target", "Target Revenue"]), status: r.sel(STATUS, ["active", "incubating", "paused", "closed"] as const, "active") } }; },
  },
  {
    base: "Ovation_OS", table: "Legal Entities & SPVs", target: "legal_entities", pg: s.legalEntities,
    async build(r) { return { values: { name: r.s(["Entity Name", "Name", "Company"], 500) ?? "Imported entity", kind: r.sel(["Type", "Entity Type"], ["company", "spv", "partnership", "trust"] as const, "company"), companyNumber: r.s(["Company Number", "Registration Number"], 50), jurisdiction: r.s(["Jurisdiction"], 200), status: r.sel(STATUS, ["active", "forming", "dormant", "dissolved"] as const, "active"), notes: [r.s(NOTES), "Historical Ovation record — not automatically bound to the current company."].filter(Boolean).join("\n") } }; },
  },
  {
    base: "Ovation_OS", table: "Strategic Initiatives & Milestones", target: "strategic_initiatives", pg: s.strategicInitiatives,
    async build(r) { return { values: { name: r.s(["Initiative", "Name", "Milestone", "Title"], 500) ?? "Imported initiative", status: r.sel(STATUS, ["planned", "active", "at_risk", "done", "dropped"] as const, "planned", { complete: "done", in_progress: "active" }), milestoneDate: r.d(["Milestone Date", "Due Date", "Target Date", "Date"]), description: r.s(NOTES) } }; },
  },
  {
    base: "Ovation_OS", table: "Slate & IP", target: "ip_projects", pg: s.ipProjects,
    async build(r) {
      return { values: {
        title: r.s(["Title", "Project", "Name", "IP Title"], 500) ?? "Untitled IP",
        logline: r.s(["Logline"]), synopsis: r.s(["Synopsis", "Summary"]), genre: r.s(["Genre"], 200),
        formatType: r.sel(["Format", "Format Type", "Type"], ["scripted_series", "feature_film", "documentary", "gameshow", "panel_show", "studio_unscripted", "podcast", "commercial", "digital_series"] as const, "scripted_series", { film: "feature_film", feature: "feature_film", doc: "documentary", game: "gameshow", panel: "panel_show", unscripted: "studio_unscripted", series: "scripted_series" }),
        stage: r.sel(["Stage", "Status", "Pipeline Stage"], ["idea", "development", "packaging", "greenlight_review", "greenlit", "in_production", "released", "shelved"] as const, "development", { concept: "idea", greenlight: "greenlight_review", production: "in_production", parked: "shelved", on_hold: "shelved" }),
        rightsStatus: r.sel(["Rights Status", "Rights"], ["unknown", "owned", "optioned", "in_negotiation", "cleared", "at_risk"] as const, "unknown"),
        targetBudgetMinor: r.m(["Target Budget", "Budget", "Estimated Budget"]),
        nextMilestone: r.s(["Next Milestone", "Next Step"], 500), nextMilestoneDate: r.d(["Next Milestone Date", "Milestone Date"]),
        decisionDate: r.d(["Decision Date", "Greenlight Date"]), notes: r.s(["Notes", "Comments"]),
      } };
    },
  },
  {
    base: "Ovation_OS", table: "Development Materials", target: "development_materials", pg: s.developmentMaterials,
    async build(r, c) {
      const ipProjectId = ipChild(c, r);
      if (!ipProjectId) { c.exception("orphan_link", r.table.id, r.id, "Material has no resolvable Slate & IP link; kept in lineage only"); return null; }
      return { values: { ipProjectId, title: r.s(["Title", "Name", "Material"], 500) ?? "Imported material", kind: r.sel(["Type", "Material Type"], ["treatment", "format_bible", "pitch_deck", "script", "sizzle", "lookbook", "research", "budget_topsheet", "other"] as const, "other", { deck: "pitch_deck", bible: "format_bible" }), versionLabel: r.s(["Version"], 50), status: r.sel(STATUS, ["draft", "in_review", "approved", "superseded"] as const, "draft"), externalUrl: (r.s(["Link", "URL"], 2000) ?? "").match(/^https?:\/\//) ? r.s(["Link", "URL"], 2000) : null, notes: r.s(NOTES) } };
    },
  },
  {
    base: "Ovation_OS", table: "Development & Greenlight Reviews", target: "greenlight_gates", pg: s.greenlightGates,
    async build(r, c) {
      const ipProjectId = ipChild(c, r);
      if (!ipProjectId) { c.exception("orphan_link", r.table.id, r.id, "Review has no resolvable Slate & IP link; kept in lineage only"); return null; }
      return { values: { ipProjectId, gate: r.sel(["Gate", "Review Type", "Stage"], ["concept", "development", "packaging", "greenlight"] as const, "development"), status: r.sel(["Decision", "Status", "Outcome"], ["pending", "in_review", "approved", "rejected", "deferred"] as const, "pending", { go: "approved", greenlit: "approved", pass: "rejected", no_go: "rejected", hold: "deferred" }), dueDate: r.d(["Review Date", "Due Date", "Date"]), decidedOn: r.d(["Decision Date", "Decided On"]), decision: r.s(["Decision Notes", "Rationale", "Decision Summary"]), notes: [r.s(NOTES), "Historical Ovation review (imported)."].filter(Boolean).join("\n") } };
    },
  },
  {
    base: "Ovation_OS", table: "Script Coverage & Creative Reviews", target: "creative_reviews", pg: s.creativeReviews,
    async build(r, c) {
      const ipProjectId = ipChild(c, r);
      if (!ipProjectId) { c.exception("orphan_link", r.table.id, r.id, "Coverage has no resolvable Slate & IP link; kept in lineage only"); return null; }
      return { values: { ipProjectId, kind: r.sel(["Type"], ["coverage", "creative_review", "format_review", "legal_read"] as const, "coverage"), reviewer: r.s(["Reviewer", "Reader"], 500), rating: r.i(["Rating", "Score"]), recommendation: r.sel(["Recommendation", "Verdict"], ["pass", "consider", "recommend", "develop_further"] as const, "consider"), summary: r.s(["Summary", "Notes", "Comments"]), reviewedOn: r.d(["Date", "Review Date"]) } };
    },
  },
  ...(["Packaging Overview", "Packaging & Attachments"] as const).map((table): Spec => ({
    base: "Ovation_OS", table, target: "packaging_items", pg: s.packagingItems,
    async build(r, c) {
      const ipProjectId = ipChild(c, r);
      if (!ipProjectId) { c.exception("orphan_link", r.table.id, r.id, "Packaging row has no resolvable Slate & IP link; kept in lineage only"); return null; }
      return { values: { ipProjectId, name: r.s(["Name", "Attachment", "Element", "Talent"], 500) ?? "Imported packaging element", kind: r.sel(["Type", "Role", "Element Type"], ["talent", "presenter", "director", "writer", "broadcaster", "partner", "financier"] as const, "talent"), status: r.sel(STATUS, ["target", "approached", "interested", "attached", "passed"] as const, "target", { confirmed: "attached" }), notes: r.s(NOTES) } };
    },
  })),
  {
    base: "Ovation_OS", table: "Rights & Chain of Title", target: "rights_entries", pg: s.rightsEntries,
    async build(r, c) {
      return { values: { title: r.s(["Right", "Title", "Name", "Document"], 500) ?? "Imported right", ipProjectId: ipChild(c, r), rightType: r.sel(["Type", "Right Type", "Category"], ["underlying", "format", "script", "music", "footage", "talent", "location", "trademark", "likeness", "archive"] as const, "underlying"), grantor: r.s(["Grantor", "Owner", "Licensor"], 500), territories: r.s(["Territory", "Territories"], 500), media: r.s(["Media", "Rights Media"], 500), startDate: r.d(["Start Date", "Start"]), endDate: r.d(["End Date", "Expiry", "Expiry Date"]), exclusive: r.b(["Exclusive"]) ?? false, restrictions: r.s(["Restrictions"]), status: r.sel(["Clearance", "Status"], ["cleared", "pending", "missing", "expired", "disputed"] as const, "pending", { signed: "cleared", secured: "cleared", outstanding: "missing" }), evidenceNote: r.s(["Evidence", "Notes"]) } };
    },
  },
  {
    base: "Ovation_OS", table: "Governance & Approvals", target: "approval_requests", pg: s.approvalRequests,
    async build(r) {
      const id = randomUUID();
      return { values: {
        id, subjectType: "historical", subjectId: id, kind: "governance", historical: true, requiredRole: "executive",
        title: r.s(["Title", "Decision", "Approval", "Name", "Item"], 500) ?? "Historical approval",
        status: r.sel(["Status", "Decision", "Outcome"], ["pending", "approved", "rejected", "withdrawn"] as const, "pending", { passed: "approved", agreed: "approved", declined: "rejected" }),
        amountMinor: r.m(["Amount", "Value"]),
        decisionNote: [r.s(["Notes", "Rationale", "Approvers", "Approver"]), "Historical Ovation governance record. Approvers are not mapped to current users."].filter(Boolean).join("\n"),
      } };
    },
  },
  {
    base: "Ovation_OS", table: "Risk Register", target: "risks", pg: s.risks,
    async build(r) { return { values: { title: r.s(["Risk", "Title", "Name"], 500) ?? "Imported risk", category: r.sel(["Category", "Type"], ["financial", "legal", "schedule", "safety", "creative", "commercial", "reputational", "operational"] as const, "operational"), likelihood: r.i(["Likelihood", "Probability"]), impact: r.i(["Impact", "Severity"]), mitigation: r.s(["Mitigation", "Response"]), status: r.sel(STATUS, ["open", "mitigating", "accepted", "closed"] as const, "open"), reviewDate: r.d(["Review Date", "Next Review"]) } }; },
  },
  {
    base: "Ovation_OS", table: "KPIs & Targets", target: "kpis", pg: s.kpis,
    async build(r) {
      const value = r.s(["Current", "Actual", "Value", "Current Value"], 200);
      return { values: { name: r.s(["KPI", "Name", "Metric"], 500) ?? "Imported KPI", definition: r.s(["Definition", "Description"]), target: r.s(["Target"], 200), unit: r.s(["Unit"], 50), period: r.s(["Period", "Frequency"], 100), manualValue: value, manualValueAsOf: value ? (r.rec.createdTime ?? "").slice(0, 10) || null : null } };
    },
  },
  {
    base: "Ovation_OS", table: "Tasks", target: "tasks", pg: s.tasks,
    async build(r) { return { values: { title: r.s(["Task", "Name", "Title"], 500) ?? "Imported task", status: r.sel(STATUS, ["todo", "doing", "blocked", "done"] as const, "todo", { in_progress: "doing", complete: "done", not_started: "todo" }), priority: r.sel(["Priority"], ["low", "normal", "high", "urgent"] as const, "normal", { medium: "normal", critical: "urgent" }), dueDate: r.d(["Due", "Due Date", "Deadline"]), description: [r.s(["Description", "Notes"]), r.s(["Owner", "Assignee"]) ? `Source owner: ${r.s(["Owner", "Assignee"])}` : null].filter(Boolean).join("\n") || null } }; },
  },
  {
    base: "Ovation_OS", table: "SOP Library", target: "sops", pg: s.sops,
    async build(r) { return { values: { title: r.s(["SOP", "Title", "Name"], 500) ?? "Imported SOP", category: r.s(["Category", "Area"], 200), body: r.s(["Procedure", "Steps", "Body", "Content", "Description"]), versionLabel: r.s(["Version"], 50) ?? "v1", status: r.sel(STATUS, ["draft", "approved", "retired"] as const, "draft", { live: "approved", active: "approved" }) } }; },
  },
  {
    base: "Ovation_OS", table: "Territories & Markets", target: "territories", pg: s.territories,
    async build(r) { return { values: { name: r.s(["Territory", "Name", "Market"], 500) ?? "Imported territory", code: r.s(["Code", "ISO Code"], 20), region: r.s(["Region"], 200), notes: r.s(NOTES) } }; },
  },
  {
    base: "Ovation_OS", table: "Team & Crew", target: "people", pg: s.people,
    async build(r) { return { values: personFields(r) }; },
  },
  {
    base: "Ovation_OS", table: "Capital Pools & Raises", target: "funding_sources", pg: s.fundingSources,
    async build(r) { return { values: { name: r.s(["Name", "Pool", "Raise", "Title"], 500) ?? "Imported capital pool", kind: "capital_pool", amountMinor: r.m(["Target", "Amount", "Target Raise", "Size"]), status: r.sel(STATUS, ["target", "soft", "committed", "closed", "received", "lapsed"] as const, "target", { open: "target", raising: "soft" }), expectedDate: r.d(["Close Date", "Target Date", "Expected Date"]), notes: r.s(NOTES) } }; },
  },
  {
    base: "Ovation_OS", table: "Automation Control Centre", target: "workflow_definitions", pg: s.workflowDefinitions,
    async build(r, c) {
      let key = (r.s(["Key", "Automation ID", "ID", "Code", "Automation Key"], 100) ?? `OVATION-${r.id}`).replace(/\s+/g, "-");
      const self = c.map.get(r.id)?.id;
      const [clash] = await c.tx.select({ id: s.workflowDefinitions.id }).from(s.workflowDefinitions).where(and(eq(s.workflowDefinitions.orgId, c.orgId), eq(s.workflowDefinitions.key, key))).limit(1);
      if (clash && clash.id !== self) { c.exception("validation", r.table.id, r.id, `Duplicate workflow key "${key}"; imported as "${key}-${r.id.slice(-4)}"`); key = `${key}-${r.id.slice(-4)}`; }
      return { values: {
        key, name: r.s(["Name", "Automation", "Title", "Workflow"], 500) ?? key, source: "ovation_spec", sourceDeployment: "spec_only", sourceRef: `Ovation Automation Control Centre ${r.id}`,
        triggerEvent: r.s(["Trigger", "Trigger Event", "Event"], 500), action: r.s(["Action", "Target Table", "Target"], 500),
        requiresApproval: r.b(["Requires Approval", "Approval Required"]) ?? true, status: "draft", disposition: "blocked",
        dispositionEvidence: "Imported specification; not live until reviewed and tested",
        notes: [r.s(["Description", "Notes", "Logic"]), r.s(["Retry", "Retry Policy"]) ? `Retry: ${r.s(["Retry", "Retry Policy"])}` : null, r.s(["Idempotency", "Idempotency Key"]) ? `Idempotency: ${r.s(["Idempotency", "Idempotency Key"])}` : null, r.s(["Test", "Test Plan", "Testing"]) ? `Test guidance: ${r.s(["Test", "Test Plan", "Testing"])}` : null].filter(Boolean).join("\n") || null,
      } };
    },
  },
];

export const SPECS: Spec[] = [...OVA, ...SAP];
/** Tables preserved only in lineage, with the reason recorded on each source record. */
export const ARCHIVE_NOTES: Record<string, string> = {
  "Workflow Queue": "Historical Airtable workflow queue; superseded by the transactional outbox",
  "Automation Run Log": "Historical automation run log; superseded by workflow_runs",
};
