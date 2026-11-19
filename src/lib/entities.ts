/**
 * Entity registry — the single declarative contract that drives server-side validation,
 * scoping and field redaction, plus the generic grid / form / detail UI.
 * Field keys are the Drizzle (camelCase) property names in src/db/schema.ts.
 */
import type { Domain } from "./permissions";

export type FieldType =
  | "text" | "textarea" | "int" | "money" | "date" | "time" | "datetime" | "bool"
  | "select" | "ref" | "url" | "email" | "bp";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  ref?: string;
  /** Show as a grid column. */
  list?: boolean;
  sensitive?: "pii" | "rate";
  /** Editable only through a dedicated, guarded workflow action. */
  readOnly?: boolean;
  /** Hidden from create/edit forms entirely (system-managed). */
  system?: boolean;
  help?: string;
}

export interface ChildDef { entity: string; foreignKey: string; label: string }

export interface EntityDef {
  key: string;
  label: string;
  plural: string;
  domain: Domain;
  titleField: string;
  /** org: no production column. production: production_id required. production_optional: nullable. */
  scope: "org" | "production" | "production_optional";
  /** For production_optional: are org-level rows (null production) visible to production-scoped users? */
  orgRowsVisibleToScoped?: boolean;
  fields: FieldDef[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  search: string[];
  children?: ChildDef[];
  /** Domain used for reads, when it differs from write domain (e.g. review comments). */
  readDomain?: Domain;
  description?: string;
}

const opt = <T extends string>(...o: T[]) => o;

export const PRODUCTION_KINDS = opt("series", "film", "commercial", "documentary", "gameshow", "panel_show", "podcast", "studio_unscripted");
export const SCENE_KINDS = opt("scene", "segment", "round", "interview", "performance", "link", "vt", "ad_break", "titles");

const production: FieldDef = { key: "productionId", label: "Production", type: "ref", ref: "productions", required: true, list: true };
const productionOpt: FieldDef = { key: "productionId", label: "Production", type: "ref", ref: "productions", list: true };
const episodeRef: FieldDef = { key: "episodeId", label: "Episode / unit", type: "ref", ref: "episodes", list: true };
const notes: FieldDef = { key: "notes", label: "Notes", type: "textarea" };

export const ENTITIES = {
  // ── Organisation & governance ──
  business_units: {
    key: "business_units", label: "Business unit", plural: "Business units", domain: "org", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "code", label: "Code", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("active", "incubating", "paused", "closed"), list: true },
      { key: "revenueTargetMinor", label: "Revenue target", type: "money", list: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "code"],
  },
  legal_entities: {
    key: "legal_entities", label: "Legal entity", plural: "Legal entities & SPVs", domain: "org", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("company", "spv", "partnership", "trust"), list: true },
      { key: "companyNumber", label: "Company number", type: "text", list: true },
      { key: "jurisdiction", label: "Jurisdiction", type: "text", list: true },
      { key: "businessUnitId", label: "Business unit", type: "ref", ref: "business_units", list: true },
      { key: "status", label: "Status", type: "select", options: opt("active", "forming", "dormant", "dissolved"), list: true },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "companyNumber"],
  },
  strategic_initiatives: {
    key: "strategic_initiatives", label: "Initiative", plural: "Strategic initiatives", domain: "org", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Initiative", type: "text", required: true, list: true },
      { key: "businessUnitId", label: "Business unit", type: "ref", ref: "business_units", list: true },
      { key: "status", label: "Status", type: "select", options: opt("planned", "active", "at_risk", "done", "dropped"), list: true },
      { key: "milestoneDate", label: "Milestone date", type: "date", list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaultSort: { key: "milestoneDate", dir: "asc" }, search: ["name"],
  },
  risks: {
    key: "risks", label: "Risk", plural: "Risk register", domain: "org", titleField: "title", scope: "production_optional",
    fields: [
      { key: "title", label: "Risk", type: "text", required: true, list: true },
      productionOpt,
      { key: "category", label: "Category", type: "select", options: opt("financial", "legal", "schedule", "safety", "creative", "commercial", "reputational", "operational"), list: true },
      { key: "likelihood", label: "Likelihood (1–5)", type: "int", list: true },
      { key: "impact", label: "Impact (1–5)", type: "int", list: true },
      { key: "status", label: "Status", type: "select", options: opt("open", "mitigating", "accepted", "closed"), list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "reviewDate", label: "Review date", type: "date", list: true },
      { key: "mitigation", label: "Mitigation", type: "textarea" },
    ],
    defaultSort: { key: "reviewDate", dir: "asc" }, search: ["title", "mitigation"],
  },
  kpis: {
    key: "kpis", label: "KPI", plural: "KPIs & targets", domain: "org", titleField: "name", scope: "org",
    description: "Live KPIs compute from the database via a metric key. Manual values must carry an as-of date.",
    fields: [
      { key: "name", label: "KPI", type: "text", required: true, list: true },
      { key: "metricKey", label: "Live metric", type: "select", options: opt("active_productions", "scheduled_shoot_days_30d", "pending_approvals", "overdue_tasks", "deliverables_due_14d", "open_risks", "failed_workflow_runs", "slate_in_development"), list: true, help: "Leave blank for a manually reported KPI." },
      { key: "target", label: "Target", type: "text", list: true },
      { key: "manualValue", label: "Manual value", type: "text", list: true },
      { key: "manualValueAsOf", label: "Manual value as of", type: "date", list: true },
      { key: "unit", label: "Unit", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users" },
      { key: "definition", label: "Definition", type: "textarea" },
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "definition"],
  },
  decisions: {
    key: "decisions", label: "Decision", plural: "Decision log", domain: "org", titleField: "title", scope: "org",
    fields: [
      { key: "title", label: "Decision", type: "text", required: true, list: true },
      { key: "decidedOn", label: "Decided on", type: "date", list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "context", label: "Context", type: "textarea" },
      { key: "decision", label: "Outcome", type: "textarea", list: true },
    ],
    defaultSort: { key: "decidedOn", dir: "desc" }, search: ["title", "decision"],
  },
  meetings: {
    key: "meetings", label: "Meeting", plural: "Meetings & board", domain: "org", titleField: "title", scope: "production_optional",
    fields: [
      { key: "title", label: "Meeting", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("board", "production", "creative", "commercial", "management"), list: true },
      { key: "heldAt", label: "Date / time", type: "datetime", list: true },
      productionOpt,
      { key: "notes", label: "Minutes / actions", type: "textarea" },
    ],
    defaultSort: { key: "heldAt", dir: "desc" }, search: ["title", "notes"],
  },
  territories: {
    key: "territories", label: "Territory", plural: "Territories & markets", domain: "commercial", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Territory", type: "text", required: true, list: true },
      { key: "code", label: "Code", type: "text", list: true },
      { key: "region", label: "Region", type: "text", list: true },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "code", "region"],
  },

  // ── Slate & development ──
  ip_projects: {
    key: "ip_projects", label: "Show / IP", plural: "Slate & IP", domain: "slate", titleField: "title", scope: "org",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "formatType", label: "Format", type: "select", options: opt("scripted_series", "feature_film", "documentary", "gameshow", "panel_show", "studio_unscripted", "podcast", "commercial", "digital_series"), list: true },
      { key: "stage", label: "Stage", type: "select", options: opt("idea", "development", "packaging", "greenlight_review", "greenlit", "in_production", "released", "shelved"), list: true },
      { key: "genre", label: "Genre", type: "text", list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "rightsStatus", label: "Rights status", type: "select", options: opt("unknown", "owned", "optioned", "in_negotiation", "cleared", "at_risk"), list: true },
      { key: "targetBudgetMinor", label: "Target budget", type: "money", list: true },
      { key: "nextMilestone", label: "Next milestone", type: "text", list: true },
      { key: "nextMilestoneDate", label: "Milestone date", type: "date", list: true },
      { key: "decisionDate", label: "Decision date", type: "date" },
      { key: "businessUnitId", label: "Business unit", type: "ref", ref: "business_units" },
      { key: "legalEntityId", label: "Owning legal entity", type: "ref", ref: "legal_entities" },
      { key: "logline", label: "Logline", type: "textarea" },
      { key: "synopsis", label: "Synopsis", type: "textarea" },
      notes,
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title", "logline", "genre"],
    children: [
      { entity: "development_materials", foreignKey: "ipProjectId", label: "Materials" },
      { entity: "greenlight_gates", foreignKey: "ipProjectId", label: "Gates" },
      { entity: "creative_reviews", foreignKey: "ipProjectId", label: "Coverage & reviews" },
      { entity: "packaging_items", foreignKey: "ipProjectId", label: "Packaging" },
      { entity: "rights_entries", foreignKey: "ipProjectId", label: "Chain of title" },
      { entity: "productions", foreignKey: "ipProjectId", label: "Productions" },
    ],
  },
  development_materials: {
    key: "development_materials", label: "Material", plural: "Development materials", domain: "slate", titleField: "title", scope: "org",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("treatment", "format_bible", "pitch_deck", "script", "sizzle", "lookbook", "research", "budget_topsheet", "other"), list: true },
      { key: "versionLabel", label: "Version", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "in_review", "approved", "superseded"), list: true },
      { key: "externalUrl", label: "Link", type: "url" },
      { key: "swdrRevisionRef", label: "SWDR revision ref", type: "text", help: "Pinned approved revision from SWDR (read-only integration)." },
      notes,
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title"],
  },
  creative_reviews: {
    key: "creative_reviews", label: "Creative review", plural: "Script coverage & reviews", domain: "slate", titleField: "kind", scope: "org",
    fields: [
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("coverage", "creative_review", "format_review", "legal_read"), list: true },
      { key: "reviewer", label: "Reviewer", type: "text", list: true },
      { key: "rating", label: "Rating (1–10)", type: "int", list: true },
      { key: "recommendation", label: "Recommendation", type: "select", options: opt("pass", "consider", "recommend", "develop_further"), list: true },
      { key: "reviewedOn", label: "Reviewed on", type: "date", list: true },
      { key: "summary", label: "Summary", type: "textarea" },
    ],
    defaultSort: { key: "reviewedOn", dir: "desc" }, search: ["reviewer", "summary"],
  },
  packaging_items: {
    key: "packaging_items", label: "Packaging item", plural: "Packaging", domain: "slate", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("talent", "presenter", "director", "writer", "broadcaster", "partner", "financier"), list: true },
      { key: "status", label: "Status", type: "select", options: opt("target", "approached", "interested", "attached", "passed"), list: true },
      { key: "personId", label: "Person", type: "ref", ref: "people" },
      { key: "companyId", label: "Company", type: "ref", ref: "companies" },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name"],
  },
  greenlight_gates: {
    key: "greenlight_gates", label: "Gate", plural: "Development & greenlight gates", domain: "slate", titleField: "gate", scope: "org",
    description: "Gate decisions are made through the approvals workflow (role-checked, immutable chain).",
    fields: [
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", required: true, list: true },
      { key: "gate", label: "Gate", type: "select", options: opt("concept", "development", "packaging", "greenlight"), required: true, list: true },
      { key: "status", label: "Status", type: "select", options: opt("pending", "in_review", "approved", "rejected", "deferred"), list: true, readOnly: true },
      { key: "dueDate", label: "Due", type: "date", list: true },
      { key: "decidedOn", label: "Decided on", type: "date", list: true, readOnly: true },
      { key: "decision", label: "Decision", type: "textarea", readOnly: true },
      notes,
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["gate", "notes"],
  },

  // ── Productions hierarchy ──
  productions: {
    key: "productions", label: "Production", plural: "Productions", domain: "production", titleField: "title", scope: "org",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "code", label: "Code", type: "text", list: true },
      { key: "kind", label: "Format", type: "select", options: PRODUCTION_KINDS, required: true, list: true },
      { key: "status", label: "Status", type: "select", options: opt("development", "pre_production", "production", "post_production", "delivered", "released", "archived"), list: true },
      { key: "usesEpisodes", label: "Has episodes / units", type: "bool", list: true, help: "Off for standalone films, commercials and one-off specials." },
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", list: true },
      { key: "startDate", label: "Start", type: "date", list: true },
      { key: "endDate", label: "End", type: "date", list: true },
      { key: "baseLocation", label: "Base", type: "text" },
      { key: "timezone", label: "Timezone", type: "text" },
      { key: "businessUnitId", label: "Business unit", type: "ref", ref: "business_units" },
      { key: "legalEntityId", label: "Production company / SPV", type: "ref", ref: "legal_entities" },
      { key: "isLegacyImport", label: "Legacy import", type: "bool", system: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title", "code"],
  },
  seasons: {
    key: "seasons", label: "Season", plural: "Seasons", domain: "production", titleField: "title", scope: "production",
    fields: [production, { key: "number", label: "Season", type: "int", required: true, list: true }, { key: "title", label: "Title", type: "text", list: true }],
    defaultSort: { key: "number", dir: "asc" }, search: ["title"],
  },
  episodes: {
    key: "episodes", label: "Episode / unit", plural: "Episodes & units", domain: "production", titleField: "title", scope: "production",
    fields: [
      production,
      { key: "seasonId", label: "Season", type: "ref", ref: "seasons" },
      { key: "number", label: "No.", type: "int", list: true },
      { key: "code", label: "Code", type: "text", list: true },
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("episode", "unit", "standalone", "pilot", "special"), list: true },
      { key: "status", label: "Status", type: "select", options: opt("development", "scripting", "prep", "shooting", "post", "delivered", "transmitted"), list: true },
      { key: "shootStart", label: "Shoot start", type: "date", list: true },
      { key: "shootEnd", label: "Shoot end", type: "date" },
      { key: "deliveryDate", label: "Delivery", type: "date", list: true },
      { key: "txDate", label: "TX / release", type: "date" },
      { key: "runningTimeMins", label: "Running time (mins)", type: "int" },
      { key: "synopsis", label: "Synopsis", type: "textarea" },
      { key: "synopsisOriginal", label: "Imported original synopsis", type: "textarea", readOnly: true, help: "Preserved verbatim from source; never rewritten." },
    ],
    defaultSort: { key: "number", dir: "asc" }, search: ["title", "code"],
    children: [{ entity: "scenes", foreignKey: "episodeId", label: "Scenes & segments" }, { entity: "post_tasks", foreignKey: "episodeId", label: "Post tasks" }, { entity: "deliverables", foreignKey: "episodeId", label: "Deliverables" }],
  },
  scenes: {
    key: "scenes", label: "Scene / segment", plural: "Scenes & segments", domain: "production", titleField: "title", scope: "production",
    fields: [
      production, episodeRef,
      { key: "number", label: "No.", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: SCENE_KINDS, list: true },
      { key: "title", label: "Heading / title", type: "text", required: true, list: true },
      { key: "intExt", label: "I/E", type: "select", options: opt("INT", "EXT", "INT/EXT", "STUDIO"), list: true },
      { key: "dayNight", label: "D/N", type: "select", options: opt("DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS"), list: true },
      { key: "locationId", label: "Location / set", type: "ref", ref: "locations", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "ready", "scheduled", "shot", "in_post", "complete", "omitted"), list: true },
      { key: "director", label: "Director", type: "text", list: true },
      { key: "pageEighths", label: "Pages (1/8ths)", type: "int", list: true },
      { key: "estDurationMins", label: "Est. mins", type: "int", list: true },
      { key: "sortOrder", label: "Running order", type: "int" },
      { key: "scriptRevisionRef", label: "Script revision", type: "text" },
      { key: "description", label: "Description / action", type: "textarea" },
      { key: "directorNotes", label: "Director notes", type: "textarea" },
      { key: "specialRequirements", label: "Special requirements", type: "textarea" },
      { key: "cameraPlan", label: "Camera plan (multi-cam)", type: "textarea" },
      { key: "graphicsNotes", label: "Graphics / questions / cues", type: "textarea" },
      { key: "audioNotes", label: "Audio notes", type: "textarea" },
    ],
    defaultSort: { key: "sortOrder", dir: "asc" }, search: ["number", "title", "description", "director"],
    children: [{ entity: "shots", foreignKey: "sceneId", label: "Shot list" }, { entity: "release_forms", foreignKey: "sceneId", label: "Releases" }],
  },
  shots: {
    key: "shots", label: "Shot", plural: "Shot lists", domain: "production", titleField: "number", scope: "production",
    fields: [
      production,
      { key: "sceneId", label: "Scene / segment", type: "ref", ref: "scenes", required: true, list: true },
      { key: "number", label: "Shot", type: "text", required: true, list: true },
      { key: "shotType", label: "Type", type: "select", options: opt("ES", "WS", "MWS", "MS", "MCU", "CU", "ECU", "OTS", "POV", "INSERT", "2S", "AERIAL", "ISO", "GV"), list: true },
      { key: "framing", label: "Framing", type: "text", list: true },
      { key: "movement", label: "Movement", type: "select", options: opt("static", "pan", "tilt", "dolly", "track", "crane", "jib", "handheld", "steadicam", "gimbal", "zoom", "drone"), list: true },
      { key: "lens", label: "Lens", type: "text" },
      { key: "camera", label: "Camera", type: "text", list: true },
      { key: "priority", label: "Priority", type: "select", options: opt("must", "should", "nice"), list: true },
      { key: "estMinutes", label: "Est. mins", type: "int", list: true },
      { key: "status", label: "Status", type: "select", options: opt("planned", "shot", "omitted"), list: true },
      { key: "sortOrder", label: "Order", type: "int" },
      { key: "description", label: "Description", type: "textarea", list: true },
      notes,
      { key: "autoGenerated", label: "Auto-generated", type: "bool", system: true },
    ],
    defaultSort: { key: "sortOrder", dir: "asc" }, search: ["number", "description"],
    children: [{ entity: "takes", foreignKey: "shotId", label: "Takes" }],
  },
  takes: {
    key: "takes", label: "Take", plural: "Takes", domain: "production", titleField: "number", scope: "production",
    fields: [
      production, { key: "shotId", label: "Shot", type: "ref", ref: "shots", required: true, list: true },
      { key: "number", label: "Take", type: "int", required: true, list: true },
      { key: "timecodeIn", label: "TC in", type: "text", list: true }, { key: "timecodeOut", label: "TC out", type: "text", list: true },
      { key: "circled", label: "Circled", type: "bool", list: true }, notes,
    ],
    defaultSort: { key: "number", dir: "asc" }, search: ["notes"],
  },
  shoot_days: {
    key: "shoot_days", label: "Shoot day", plural: "Shoot days", domain: "production", titleField: "date", scope: "production",
    fields: [
      production,
      { key: "date", label: "Date", type: "date", required: true, list: true },
      { key: "dayNumber", label: "Day #", type: "int", list: true },
      { key: "unit", label: "Unit", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("planned", "confirmed", "wrapped", "cancelled"), list: true },
      { key: "generalCall", label: "General call", type: "time", list: true },
      { key: "estWrap", label: "Est. wrap", type: "time", list: true },
      { key: "baseLocationId", label: "Unit base", type: "ref", ref: "locations", list: true },
      { key: "unitBaseNotes", label: "Unit base / parking", type: "textarea" },
      { key: "weatherNote", label: "Weather (entered)", type: "text" },
      { key: "sunrise", label: "Sunrise", type: "text" }, { key: "sunset", label: "Sunset", type: "text" },
      { key: "safetyNotes", label: "Health & safety", type: "textarea" },
      notes,
    ],
    defaultSort: { key: "date", dir: "asc" }, search: ["unit", "notes"],
  },
  transport_bookings: {
    key: "transport_bookings", label: "Transport", plural: "Transport", domain: "production", titleField: "kind", scope: "production",
    fields: [
      production, { key: "shootDayId", label: "Shoot day", type: "ref", ref: "shoot_days", list: true },
      { key: "kind", label: "Vehicle type", type: "select", options: opt("car", "minibus", "coach", "van", "truck", "taxi", "train", "flight"), list: true },
      { key: "pickupTime", label: "Pickup", type: "time", list: true },
      { key: "pickupLocation", label: "From", type: "text", list: true }, { key: "dropoffLocation", label: "To", type: "text", list: true },
      { key: "driver", label: "Driver", type: "text", list: true }, { key: "vehicle", label: "Vehicle / reg", type: "text" },
      { key: "passengers", label: "Passengers", type: "textarea" }, { key: "costMinor", label: "Cost", type: "money" }, notes,
    ],
    defaultSort: { key: "pickupTime", dir: "asc" }, search: ["driver", "pickupLocation", "dropoffLocation"],
  },
  catering_orders: {
    key: "catering_orders", label: "Catering order", plural: "Catering", domain: "production", titleField: "meal", scope: "production",
    fields: [
      production, { key: "shootDayId", label: "Shoot day", type: "ref", ref: "shoot_days", list: true },
      { key: "meal", label: "Meal", type: "select", options: opt("breakfast", "lunch", "dinner", "running_buffet", "snacks"), list: true },
      { key: "serveTime", label: "Serve time", type: "time", list: true }, { key: "headcount", label: "Headcount", type: "int", list: true },
      { key: "supplierCompanyId", label: "Supplier", type: "ref", ref: "companies", list: true },
      { key: "dietaryNotes", label: "Dietary", type: "textarea" }, { key: "costMinor", label: "Cost", type: "money" }, notes,
    ],
    defaultSort: { key: "serveTime", dir: "asc" }, search: ["dietaryNotes"],
  },
  resource_bookings: {
    key: "resource_bookings", label: "Resource booking", plural: "Equipment & resource bookings", domain: "resources", titleField: "startDate", scope: "production",
    fields: [
      production, { key: "resourceId", label: "Resource", type: "ref", ref: "resources", required: true, list: true },
      { key: "shootDayId", label: "Shoot day", type: "ref", ref: "shoot_days", list: true },
      { key: "startDate", label: "From", type: "date", required: true, list: true }, { key: "endDate", label: "To", type: "date", required: true, list: true },
      { key: "quantity", label: "Qty", type: "int", list: true },
      { key: "status", label: "Status", type: "select", options: opt("hold", "confirmed", "released"), list: true }, notes,
    ],
    defaultSort: { key: "startDate", dir: "asc" }, search: ["notes"],
  },
  location_bookings: {
    key: "location_bookings", label: "Location booking", plural: "Location & studio bookings", domain: "resources", titleField: "startDate", scope: "production",
    fields: [
      production, { key: "locationId", label: "Location / studio", type: "ref", ref: "locations", required: true, list: true },
      { key: "startDate", label: "From", type: "date", required: true, list: true }, { key: "endDate", label: "To", type: "date", required: true, list: true },
      { key: "status", label: "Status", type: "select", options: opt("hold", "confirmed", "released"), list: true },
      { key: "costMinor", label: "Cost", type: "money", list: true }, notes,
    ],
    defaultSort: { key: "startDate", dir: "asc" }, search: ["notes"],
  },

  // ── People ──
  people: {
    key: "people", label: "Person", plural: "People", domain: "people", titleField: "fullName", scope: "org",
    fields: [
      { key: "fullName", label: "Name", type: "text", required: true, list: true },
      { key: "preferredName", label: "Known as", type: "text" },
      { key: "pronouns", label: "Pronouns", type: "text" },
      { key: "defaultDepartment", label: "Department", type: "text", list: true },
      { key: "companyId", label: "Company / agency", type: "ref", ref: "companies", list: true },
      { key: "email", label: "Email", type: "email", sensitive: "pii", list: true },
      { key: "phone", label: "Phone", type: "text", sensitive: "pii", list: true },
      { key: "address", label: "Address", type: "textarea", sensitive: "pii" },
      { key: "agentName", label: "Agent", type: "text" },
      { key: "agentEmail", label: "Agent email", type: "email", sensitive: "pii" },
      { key: "emergencyContact", label: "Emergency contact", type: "text", sensitive: "pii" },
      { key: "dietary", label: "Dietary / access needs", type: "text", sensitive: "pii" },
      notes,
    ],
    defaultSort: { key: "fullName", dir: "asc" }, search: ["fullName", "preferredName", "defaultDepartment"],
    children: [{ entity: "engagements", foreignKey: "personId", label: "Engagements" }, { entity: "availability_blocks", foreignKey: "personId", label: "Availability" }],
  },
  companies: {
    key: "companies", label: "Company", plural: "Companies & partners", domain: "people", readDomain: "people", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("supplier", "broadcaster", "distributor", "platform", "sponsor", "agency", "partner", "investor", "facility"), list: true },
      { key: "status", label: "Status", type: "select", options: opt("active", "prospect", "inactive"), list: true },
      { key: "website", label: "Website", type: "url", list: true },
      { key: "email", label: "Email", type: "email", list: true },
      { key: "phone", label: "Phone", type: "text" },
      { key: "address", label: "Address", type: "textarea" },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name"],
  },
  engagements: {
    key: "engagements", label: "Engagement", plural: "Cast & crew engagements", domain: "people", titleField: "roleTitle", scope: "production",
    description: "One person can hold several engagements (cast and crew) across productions.",
    fields: [
      production,
      { key: "personId", label: "Person", type: "ref", ref: "people", required: true, list: true },
      { key: "kind", label: "Kind", type: "select", options: opt("cast", "crew", "guest", "contestant", "panellist", "presenter", "contributor"), required: true, list: true },
      { key: "roleTitle", label: "Role", type: "text", list: true },
      { key: "characterName", label: "Character", type: "text", list: true },
      { key: "department", label: "Department", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("proposed", "offered", "confirmed", "released", "cancelled"), list: true },
      { key: "contractStatus", label: "Contract", type: "select", options: opt("none", "draft", "generated", "sent", "signed", "blocked"), list: true, readOnly: true },
      { key: "rateMinor", label: "Rate", type: "money", sensitive: "rate", list: true },
      { key: "rateUnit", label: "Per", type: "select", options: opt("day", "week", "episode", "flat") },
      { key: "feeTotalMinor", label: "Total fee", type: "money", sensitive: "rate" },
      { key: "startDate", label: "Start", type: "date" }, { key: "endDate", label: "End", type: "date" },
      { key: "detailsEmailSentAt", label: "Details sent", type: "datetime", readOnly: true },
      notes,
    ],
    defaultSort: { key: "kind", dir: "asc" }, search: ["roleTitle", "characterName", "department"],
  },
  availability_blocks: {
    key: "availability_blocks", label: "Availability", plural: "Availability", domain: "people", titleField: "kind", scope: "org",
    fields: [
      { key: "personId", label: "Person", type: "ref", ref: "people", required: true, list: true },
      { key: "startDate", label: "From", type: "date", required: true, list: true }, { key: "endDate", label: "To", type: "date", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("unavailable", "hold", "booked"), list: true },
      { key: "note", label: "Note", type: "text", list: true },
    ],
    defaultSort: { key: "startDate", dir: "asc" }, search: ["note"],
  },

  // ── Resources ──
  locations: {
    key: "locations", label: "Location", plural: "Locations & studios", domain: "resources", titleField: "name", scope: "org",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("location", "studio", "stage", "facility", "unit_base"), list: true },
      { key: "status", label: "Status", type: "select", options: opt("scouted", "hold", "confirmed", "cleared", "unavailable"), list: true },
      { key: "address", label: "Address", type: "textarea", list: true },
      { key: "postcode", label: "Postcode", type: "text", list: true },
      { key: "what3words", label: "what3words", type: "text" },
      { key: "contactName", label: "Contact", type: "text" }, { key: "contactPhone", label: "Contact phone", type: "text" },
      { key: "parking", label: "Parking", type: "textarea" }, { key: "accessNotes", label: "Access", type: "textarea" },
      { key: "nearestHospital", label: "Nearest A&E", type: "text" },
      { key: "permitRequired", label: "Permit required", type: "bool", list: true },
      { key: "allowsSharedUse", label: "Shared use allowed", type: "bool", help: "Studios/facilities that can host several units on one date." },
      { key: "dailyCostMinor", label: "Daily cost", type: "money" },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "address", "postcode"],
  },
  resources: {
    key: "resources", label: "Resource", plural: "Props, wardrobe & equipment", domain: "resources", titleField: "name", scope: "production_optional", orgRowsVisibleToScoped: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Kind", type: "select", options: opt("prop", "wardrobe", "equipment", "set", "vehicle", "graphics"), required: true, list: true },
      { key: "category", label: "Category", type: "text", list: true },
      { key: "quantity", label: "Qty", type: "int", list: true },
      { key: "status", label: "Status", type: "select", options: opt("available", "booked", "checked_out", "maintenance", "lost", "retired"), list: true },
      { key: "characterName", label: "Character (wardrobe)", type: "text", list: true },
      { key: "size", label: "Size", type: "text" },
      { key: "serialNumber", label: "Serial / asset tag", type: "text" },
      { key: "supplierCompanyId", label: "Supplier", type: "ref", ref: "companies" },
      { key: "dailyRateMinor", label: "Daily rate", type: "money" },
      { key: "productionId", label: "Owned by production", type: "ref", ref: "productions", help: "Blank = shared organisation stock." },
      notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name", "category", "characterName", "serialNumber"],
  },
  resource_checkouts: {
    key: "resource_checkouts", label: "Checkout", plural: "Check-out / check-in", domain: "resources", titleField: "outAt", scope: "production_optional", orgRowsVisibleToScoped: true,
    fields: [
      { key: "resourceId", label: "Resource", type: "ref", ref: "resources", required: true, list: true },
      { key: "personId", label: "Checked out to", type: "ref", ref: "people", list: true },
      productionOpt,
      { key: "outAt", label: "Out", type: "datetime", list: true }, { key: "dueAt", label: "Due", type: "datetime", list: true },
      { key: "inAt", label: "Returned", type: "datetime", list: true },
      { key: "conditionOut", label: "Condition out", type: "text" }, { key: "conditionIn", label: "Condition in", type: "text" },
    ],
    defaultSort: { key: "outAt", dir: "desc" }, search: ["conditionOut", "conditionIn"],
  },

  // ── Money ──
  budgets: {
    key: "budgets", label: "Budget", plural: "Budgets", domain: "finance", titleField: "name", scope: "production",
    fields: [
      production, { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "versionLabel", label: "Version", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "submitted", "approved", "locked"), list: true, readOnly: true },
      { key: "currency", label: "Currency", type: "text", list: true },
      { key: "approvedAt", label: "Approved", type: "datetime", readOnly: true, list: true },
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name"],
    children: [{ entity: "budget_lines", foreignKey: "budgetId", label: "Lines" }],
  },
  budget_lines: {
    key: "budget_lines", label: "Budget line", plural: "Budget lines", domain: "finance", titleField: "category", scope: "production",
    fields: [
      production, { key: "budgetId", label: "Budget", type: "ref", ref: "budgets", required: true, list: true },
      { key: "code", label: "Code", type: "text", list: true },
      { key: "category", label: "Category", type: "text", required: true, list: true },
      { key: "description", label: "Description", type: "text", list: true },
      { key: "episodeId", label: "Episode", type: "ref", ref: "episodes" },
      { key: "estimateMinor", label: "Estimate (net)", type: "money", list: true },
      { key: "approvedMinor", label: "Approved (net)", type: "money", list: true },
      { key: "forecastMinor", label: "Forecast EFC (net)", type: "money", list: true },
      { key: "vatRateBp", label: "VAT rate", type: "bp", list: true },
      { key: "sortOrder", label: "Order", type: "int" },
    ],
    defaultSort: { key: "sortOrder", dir: "asc" }, search: ["code", "category", "description"],
  },
  purchase_orders: {
    key: "purchase_orders", label: "Purchase order", plural: "Purchase orders", domain: "finance", titleField: "number", scope: "production",
    fields: [
      production, { key: "number", label: "PO #", type: "text", required: true, list: true },
      { key: "description", label: "Description", type: "text", required: true, list: true },
      { key: "supplierCompanyId", label: "Supplier", type: "ref", ref: "companies", list: true },
      { key: "budgetLineId", label: "Budget line", type: "ref", ref: "budget_lines", list: true },
      { key: "netMinor", label: "Net", type: "money", required: true, list: true },
      { key: "vatMinor", label: "VAT", type: "money", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "pending_approval", "approved", "rejected", "closed"), list: true, readOnly: true },
    ],
    defaultSort: { key: "number", dir: "asc" }, search: ["number", "description"],
  },
  expenses: {
    key: "expenses", label: "Expense", plural: "Expenses & actuals", domain: "finance", titleField: "description", scope: "production",
    fields: [
      production, { key: "description", label: "Description", type: "text", required: true, list: true },
      { key: "incurredOn", label: "Date", type: "date", list: true },
      { key: "supplier", label: "Supplier / payee", type: "text", list: true },
      { key: "budgetLineId", label: "Budget line", type: "ref", ref: "budget_lines", list: true },
      { key: "purchaseOrderId", label: "PO", type: "ref", ref: "purchase_orders" },
      { key: "claimantPersonId", label: "Claimant", type: "ref", ref: "people" },
      { key: "netMinor", label: "Net", type: "money", required: true, list: true },
      { key: "vatMinor", label: "VAT", type: "money", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "submitted", "approved", "rejected", "paid"), list: true, readOnly: true },
    ],
    defaultSort: { key: "incurredOn", dir: "desc" }, search: ["description", "supplier"],
  },
  funding_sources: {
    key: "funding_sources", label: "Funding source", plural: "Funding & capital", domain: "funding", titleField: "name", scope: "production_optional",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("equity", "debt", "presale", "incentive", "grant", "sponsor", "capital_pool", "founder_advance"), list: true },
      productionOpt, { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", list: true },
      { key: "counterpartyCompanyId", label: "Counterparty", type: "ref", ref: "companies", list: true },
      { key: "legalEntityId", label: "Receiving entity", type: "ref", ref: "legal_entities" },
      { key: "amountMinor", label: "Amount", type: "money", list: true },
      { key: "status", label: "Status", type: "select", options: opt("target", "soft", "committed", "closed", "received", "lapsed"), list: true },
      { key: "expectedDate", label: "Expected", type: "date", list: true }, notes,
    ],
    defaultSort: { key: "expectedDate", dir: "asc" }, search: ["name"],
  },

  // ── Legal & rights ──
  contracts: {
    key: "contracts", label: "Contract", plural: "Contracts & agreements", domain: "legal", titleField: "title", scope: "production_optional",
    description: "Signed status requires uploaded signature evidence. Generation and sending run through the gated contract workflow.",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("cast", "crew", "location", "licence", "sponsorship", "distribution", "chain_of_title", "nda", "services", "other"), list: true },
      productionOpt,
      { key: "status", label: "Status", type: "select", options: opt("draft", "generated", "approved", "sent", "signed", "countersigned", "expired", "terminated", "blocked"), list: true, readOnly: true },
      { key: "counterpartyPersonId", label: "Counterparty (person)", type: "ref", ref: "people", list: true },
      { key: "counterpartyCompanyId", label: "Counterparty (company)", type: "ref", ref: "companies", list: true },
      { key: "engagementId", label: "Engagement", type: "ref", ref: "engagements" },
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects" },
      { key: "legalEntityId", label: "Contracting entity", type: "ref", ref: "legal_entities" },
      { key: "valueMinor", label: "Value", type: "money", list: true, sensitive: "rate" },
      { key: "startDate", label: "Start", type: "date", list: true }, { key: "endDate", label: "End", type: "date", list: true },
      { key: "signedAt", label: "Signed", type: "datetime", readOnly: true },
      { key: "providerRef", label: "Provider reference", type: "text", readOnly: true },
      notes,
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title"],
    children: [{ entity: "contract_obligations", foreignKey: "contractId", label: "Obligations" }],
  },
  contract_obligations: {
    key: "contract_obligations", label: "Obligation", plural: "Contract obligations", domain: "legal", titleField: "description", scope: "production_optional",
    fields: [
      { key: "contractId", label: "Contract", type: "ref", ref: "contracts", required: true, list: true },
      productionOpt,
      { key: "description", label: "Obligation", type: "text", required: true, list: true },
      { key: "dueDate", label: "Due", type: "date", list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "status", label: "Status", type: "select", options: opt("open", "met", "breached", "waived"), list: true },
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["description"],
  },
  release_forms: {
    key: "release_forms", label: "Release form", plural: "Release forms", domain: "legal", titleField: "name", scope: "production",
    fields: [
      production, { key: "name", label: "Name", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("appearance", "location", "minor", "materials", "music"), list: true },
      { key: "personId", label: "Person", type: "ref", ref: "people", list: true },
      { key: "sceneId", label: "Scene / segment", type: "ref", ref: "scenes", list: true },
      { key: "status", label: "Status", type: "select", options: opt("required", "sent", "signed", "refused", "missing"), list: true },
      { key: "signedAt", label: "Signed", type: "datetime", list: true }, notes,
    ],
    defaultSort: { key: "name", dir: "asc" }, search: ["name"],
  },
  rights_entries: {
    key: "rights_entries", label: "Rights entry", plural: "Rights & chain of title", domain: "legal", titleField: "title", scope: "production_optional",
    fields: [
      { key: "title", label: "Right", type: "text", required: true, list: true },
      { key: "rightType", label: "Type", type: "select", options: opt("underlying", "format", "script", "music", "footage", "talent", "location", "trademark", "likeness", "archive"), list: true },
      { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", list: true },
      productionOpt,
      { key: "status", label: "Clearance", type: "select", options: opt("cleared", "pending", "missing", "expired", "disputed"), list: true },
      { key: "grantor", label: "Grantor", type: "text", list: true },
      { key: "granteeLegalEntityId", label: "Grantee entity", type: "ref", ref: "legal_entities" },
      { key: "territories", label: "Territories", type: "text", list: true },
      { key: "media", label: "Media", type: "text", list: true },
      { key: "startDate", label: "Start", type: "date" }, { key: "endDate", label: "Expiry", type: "date", list: true },
      { key: "exclusive", label: "Exclusive", type: "bool" },
      { key: "contractId", label: "Evidence contract", type: "ref", ref: "contracts" },
      { key: "restrictions", label: "Restrictions", type: "textarea" },
      { key: "evidenceNote", label: "Evidence note", type: "textarea" },
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title", "grantor"],
  },
  licence_windows: {
    key: "licence_windows", label: "Licence window", plural: "Rights deals & licence windows", domain: "commercial", titleField: "territory", scope: "production_optional",
    fields: [
      { key: "licenseeCompanyId", label: "Licensee", type: "ref", ref: "companies", list: true },
      productionOpt, { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", list: true },
      { key: "rightsEntryId", label: "Underlying right", type: "ref", ref: "rights_entries" },
      { key: "territory", label: "Territory", type: "text", list: true }, { key: "media", label: "Media", type: "text", list: true },
      { key: "startDate", label: "Start", type: "date", list: true }, { key: "endDate", label: "End", type: "date", list: true },
      { key: "exclusive", label: "Exclusive", type: "bool", list: true },
      { key: "feeMinor", label: "Fee", type: "money", list: true },
      { key: "status", label: "Status", type: "select", options: opt("proposed", "negotiating", "signed", "active", "expired"), list: true },
    ],
    defaultSort: { key: "startDate", dir: "asc" }, search: ["territory", "media"],
  },

  // ── Post & delivery ──
  media_assets: {
    key: "media_assets", label: "Media asset", plural: "Media & ingest", domain: "post", titleField: "label", scope: "production",
    fields: [
      production, { key: "label", label: "Label", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("rushes", "audio", "graphics", "edit", "still", "music", "document"), list: true },
      episodeRef, { key: "sceneId", label: "Scene", type: "ref", ref: "scenes", list: true },
      { key: "shotId", label: "Shot", type: "ref", ref: "shots" }, { key: "shootDayId", label: "Shoot day", type: "ref", ref: "shoot_days", list: true },
      { key: "ingestStatus", label: "Ingest", type: "select", options: opt("pending", "ingested", "verified", "failed"), list: true },
      { key: "externalRef", label: "External reference / path", type: "text" },
      { key: "durationSecs", label: "Duration (s)", type: "int" }, { key: "checksum", label: "Checksum", type: "text" },
    ],
    defaultSort: { key: "label", dir: "asc" }, search: ["label", "externalRef"],
  },
  post_tasks: {
    key: "post_tasks", label: "Post task", plural: "Post-production tasks", domain: "post", titleField: "title", scope: "production",
    fields: [
      production, { key: "title", label: "Task", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("ingest", "edit", "assembly", "offline", "online", "grade", "sound", "music", "graphics", "vfx", "subtitles", "qc", "delivery"), list: true },
      episodeRef, { key: "sceneId", label: "Scene", type: "ref", ref: "scenes", list: true },
      { key: "assigneePersonId", label: "Assignee", type: "ref", ref: "people", list: true },
      { key: "status", label: "Status", type: "select", options: opt("todo", "in_progress", "review", "done", "blocked"), list: true },
      { key: "dueDate", label: "Due", type: "date", list: true }, notes,
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["title", "notes"],
  },
  edit_versions: {
    key: "edit_versions", label: "Edit version", plural: "Edit versions & review", domain: "review", titleField: "versionLabel", scope: "production",
    fields: [
      production, episodeRef, { key: "postTaskId", label: "Post task", type: "ref", ref: "post_tasks" },
      { key: "versionLabel", label: "Version", type: "text", required: true, list: true },
      { key: "kind", label: "Cut", type: "select", options: opt("assembly", "rough_cut", "fine_cut", "picture_lock", "online", "final"), list: true },
      { key: "reviewUrl", label: "Review link", type: "url", list: true },
      { key: "mediaAssetId", label: "Media asset", type: "ref", ref: "media_assets" },
      { key: "status", label: "Status", type: "select", options: opt("in_review", "changes_requested", "approved"), list: true, readOnly: true },
      { key: "submittedAt", label: "Submitted", type: "datetime", list: true, readOnly: true },
      { key: "approvedAt", label: "Approved", type: "datetime", readOnly: true },
    ],
    defaultSort: { key: "submittedAt", dir: "desc" }, search: ["versionLabel"],
    children: [{ entity: "review_comments", foreignKey: "editVersionId", label: "Review comments" }],
  },
  review_comments: {
    key: "review_comments", label: "Review comment", plural: "Review comments", domain: "review", titleField: "body", scope: "production",
    fields: [
      production, { key: "editVersionId", label: "Edit version", type: "ref", ref: "edit_versions", required: true, list: true },
      { key: "timecode", label: "Timecode", type: "text", list: true },
      { key: "body", label: "Comment", type: "textarea", required: true, list: true },
      { key: "resolved", label: "Resolved", type: "bool", list: true },
    ],
    defaultSort: { key: "timecode", dir: "asc" }, search: ["body"],
  },
  deliverables: {
    key: "deliverables", label: "Deliverable", plural: "Deliverables", domain: "review", titleField: "title", scope: "production",
    description: "Approval checks rights clearance; delivery requires prior approval.",
    fields: [
      production, episodeRef, { key: "title", label: "Deliverable", type: "text", required: true, list: true },
      { key: "spec", label: "Spec", type: "text", list: true },
      { key: "destinationCompanyId", label: "Destination", type: "ref", ref: "companies", list: true },
      { key: "contractId", label: "Contract", type: "ref", ref: "contracts" },
      { key: "dueDate", label: "Due", type: "date", list: true },
      { key: "status", label: "Status", type: "select", options: opt("pending", "in_progress", "qc", "ready_for_approval", "approved", "delivered", "rejected"), list: true, readOnly: true },
      { key: "requiresRightsClearance", label: "Requires rights clearance", type: "bool" },
      { key: "approvedAt", label: "Approved", type: "datetime", readOnly: true, list: true },
      { key: "deliveredAt", label: "Delivered", type: "datetime", readOnly: true },
      notes,
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["title", "spec"],
  },
  releases: {
    key: "releases", label: "Release", plural: "Release & distribution", domain: "commercial", titleField: "platform", scope: "production",
    fields: [
      production, episodeRef,
      { key: "channelCompanyId", label: "Broadcaster / platform", type: "ref", ref: "companies", list: true },
      { key: "platform", label: "Channel / slot", type: "text", list: true },
      { key: "territory", label: "Territory", type: "text", list: true },
      { key: "releaseDate", label: "Release", type: "date", list: true }, { key: "windowEnd", label: "Window end", type: "date", list: true },
      { key: "status", label: "Status", type: "select", options: opt("planned", "scheduled", "released", "cancelled"), list: true }, notes,
    ],
    defaultSort: { key: "releaseDate", dir: "asc" }, search: ["platform", "territory"],
  },

  // ── Commercial ──
  sales_opportunities: {
    key: "sales_opportunities", label: "Sales opportunity", plural: "Sales & licensing pipeline", domain: "commercial", titleField: "title", scope: "production_optional",
    fields: [
      { key: "title", label: "Opportunity", type: "text", required: true, list: true },
      { key: "buyerCompanyId", label: "Buyer", type: "ref", ref: "companies", list: true },
      productionOpt, { key: "ipProjectId", label: "Show / IP", type: "ref", ref: "ip_projects", list: true },
      { key: "territory", label: "Territory", type: "text", list: true }, { key: "rightsType", label: "Rights", type: "text", list: true },
      { key: "stage", label: "Stage", type: "select", options: opt("lead", "pitched", "negotiating", "won", "lost"), list: true },
      { key: "valueMinor", label: "Value", type: "money", list: true }, { key: "probabilityPct", label: "Probability %", type: "int", list: true },
      { key: "expectedClose", label: "Expected close", type: "date", list: true }, notes,
    ],
    defaultSort: { key: "expectedClose", dir: "asc" }, search: ["title", "territory"],
  },
  sponsor_deals: {
    key: "sponsor_deals", label: "Sponsor / brand deal", plural: "Sponsorship & brand integrations", domain: "commercial", titleField: "title", scope: "production_optional",
    fields: [
      { key: "title", label: "Deal", type: "text", required: true, list: true },
      { key: "kind", label: "Type", type: "select", options: opt("sponsorship", "brand_integration", "product_placement", "partnership", "marketing"), list: true },
      { key: "companyId", label: "Brand / partner", type: "ref", ref: "companies", list: true },
      productionOpt,
      { key: "stage", label: "Stage", type: "select", options: opt("lead", "negotiating", "contracted", "delivering", "complete", "lost"), list: true },
      { key: "valueMinor", label: "Value", type: "money", list: true },
      { key: "startDate", label: "Start", type: "date", list: true }, { key: "endDate", label: "End", type: "date" },
      { key: "contractId", label: "Contract", type: "ref", ref: "contracts" },
      { key: "obligations", label: "Obligations", type: "textarea" },
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title"],
    children: [{ entity: "commercial_deliverables", foreignKey: "sponsorDealId", label: "Commercial deliverables" }],
  },
  commercial_deliverables: {
    key: "commercial_deliverables", label: "Commercial deliverable", plural: "Commercial deliverables", domain: "commercial", titleField: "description", scope: "production_optional",
    fields: [
      { key: "sponsorDealId", label: "Deal", type: "ref", ref: "sponsor_deals", required: true, list: true },
      { key: "description", label: "Deliverable", type: "text", required: true, list: true },
      productionOpt, episodeRef, { key: "sceneId", label: "Scene / segment", type: "ref", ref: "scenes" },
      { key: "dueDate", label: "Due", type: "date", list: true },
      { key: "status", label: "Status", type: "select", options: opt("pending", "scheduled", "delivered", "verified", "missed"), list: true },
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["description"],
  },

  // ── Operations ──
  tasks: {
    key: "tasks", label: "Task", plural: "Tasks", domain: "ops", titleField: "title", scope: "production_optional", orgRowsVisibleToScoped: true,
    fields: [
      { key: "title", label: "Task", type: "text", required: true, list: true },
      productionOpt,
      { key: "status", label: "Status", type: "select", options: opt("todo", "doing", "blocked", "done"), list: true },
      { key: "priority", label: "Priority", type: "select", options: opt("low", "normal", "high", "urgent"), list: true },
      { key: "assigneeUserId", label: "Assignee", type: "ref", ref: "users", list: true },
      { key: "dueDate", label: "Due", type: "date", list: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaultSort: { key: "dueDate", dir: "asc" }, search: ["title", "description"],
  },
  sops: {
    key: "sops", label: "SOP", plural: "SOP library", domain: "ops", titleField: "title", scope: "org",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, list: true },
      { key: "category", label: "Category", type: "text", list: true },
      { key: "status", label: "Status", type: "select", options: opt("draft", "approved", "retired"), list: true },
      { key: "versionLabel", label: "Version", type: "text", list: true },
      { key: "ownerUserId", label: "Owner", type: "ref", ref: "users", list: true },
      { key: "body", label: "Procedure", type: "textarea" },
    ],
    defaultSort: { key: "title", dir: "asc" }, search: ["title", "category", "body"],
  },
} as const satisfies Record<string, EntityDef>;

export type EntityKey = keyof typeof ENTITIES | "users";
export type RegisteredEntityKey = keyof typeof ENTITIES;

export function getEntity(key: string): EntityDef | undefined {
  return (ENTITIES as Record<string, EntityDef>)[key];
}
export function isEntityKey(key: string): key is RegisteredEntityKey {
  return Object.prototype.hasOwnProperty.call(ENTITIES, key);
}
export function humanize(v: string | null | undefined) {
  if (!v) return "";
  return v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
