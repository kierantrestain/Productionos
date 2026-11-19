/**
 * Bang On Production OS — canonical relational schema.
 *
 * Hierarchy: organisation → business_unit → ip_project (show/IP) → production →
 * season → episode/unit → scene/segment → shot/take → shoot_day/schedule_block →
 * media_asset → post_task/edit_version → deliverable/release.
 *
 * Conventions
 *  - Every tenant row carries org_id; production-scoped rows also carry production_id.
 *  - Money is stored in minor units (pence) with an ISO currency code.
 *  - Timestamps are UTC (timestamptz). Dates without time use `date`.
 *  - `version` supports optimistic concurrency; `archived_at` is a reversible soft delete.
 *  - Airtable lineage lives in source_records, never as primary identifiers.
 */
import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import {
  pgTable, uuid, text, timestamp, integer, bigint, boolean, date, time, jsonb, doublePrecision,
  uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: "number" });

const common = () => ({
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  version: integer("version").notNull().default(1),
  archivedAt: ts("archived_at"),
});

// ───────────────────────────── Tenancy, identity, control ─────────────────────────────

export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("Europe/London"),
  currency: text("currency").notNull().default("GBP"),
  isDemo: boolean("is_demo").notNull().default(false),
  settings: jsonb("settings").$type<OrgSettings>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  disabledAt: ts("disabled_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Role per organisation. Production-level scoping lives in production_members. */
export const memberships = pgTable("memberships", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  /** Role on the base platform: owner | creator | editor | commenter | reader. */
  platformRole: text("platform_role").notNull().default("editor"),
  personId: uuid("person_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)]);

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  userAgent: text("user_agent"),
});

export const invites = pgTable("invites", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  productionIds: jsonb("production_ids").$type<string[]>().notNull().default([]),
  /** Platform role granted on acceptance (owner | creator | editor | commenter | reader). */
  platformRole: text("platform_role"),
  invitedBy: uuid("invited_by"),
  acceptedAt: ts("accepted_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Machine credentials for authenticated integrations (SWDR, Mimic OS). Hashes only. */
export const apiTokens = pgTable("api_tokens", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by"),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Append-only. A DB trigger (migration 0001) rejects UPDATE/DELETE. */
export const auditEvents = pgTable("audit_events", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  actorUserId: uuid("actor_user_id"),
  actorLabel: text("actor_label"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  productionId: uuid("production_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  meta: jsonb("meta"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("audit_entity").on(t.orgId, t.entityType, t.entityId), index("audit_at").on(t.orgId, t.at)]);

export const savedViews = pgTable("saved_views", {
  ...common(),
  userId: uuid("user_id").notNull(),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  shared: boolean("shared").notNull().default(false),
  config: jsonb("config").$type<{ q?: string; filters?: Record<string, string>; sort?: string; dir?: "asc" | "desc"; productionId?: string }>().notNull(),
});

export const attachments = pgTable("attachments", {
  ...common(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  productionId: uuid("production_id"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  sensitivity: text("sensitivity").notNull().default("internal"),
  sourceAttachmentId: text("source_attachment_id"),
}, (t) => [index("attachments_entity").on(t.orgId, t.entityType, t.entityId)]);

export const comments = pgTable("comments", {
  ...common(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  productionId: uuid("production_id"),
  body: text("body").notNull(),
}, (t) => [index("comments_entity").on(t.orgId, t.entityType, t.entityId)]);

// ───────────────────────────── Migration lineage ─────────────────────────────

export const importBatches = pgTable("import_batches", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(), // dry_run | staging | apply
  sourceLabel: text("source_label").notNull(),
  status: text("status").notNull().default("running"),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  startedBy: uuid("started_by"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

export const sourceRecords = pgTable("source_records", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  sourceSystem: text("source_system").notNull().default("airtable"),
  baseId: text("base_id").notNull(),
  tableId: text("table_id").notNull(),
  tableName: text("table_name"),
  recordId: text("record_id").notNull(),
  targetEntityType: text("target_entity_type"),
  targetId: uuid("target_id"),
  importBatchId: uuid("import_batch_id"),
  sourceModifiedAt: ts("source_modified_at"),
  sourceHash: text("source_hash").notNull(),
  migrationStatus: text("migration_status").notNull(), // imported | archived | exception | updated | unchanged
  resolutionNote: text("resolution_note"),
  /** Raw cells for forensic comparison. Restricted to org_admin; never shown on crew screens. */
  raw: jsonb("raw"),
  importedAt: ts("imported_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("source_records_key").on(t.orgId, t.baseId, t.tableId, t.recordId), index("source_records_target").on(t.targetEntityType, t.targetId)]);

export const importExceptions = pgTable("import_exceptions", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  importBatchId: uuid("import_batch_id").notNull(),
  baseId: text("base_id").notNull(),
  tableId: text("table_id").notNull(),
  recordId: text("record_id"),
  kind: text("kind").notNull(), // orphan_link | unmapped_field | validation | attachment_failed | reconciliation
  detail: text("detail").notNull(),
  resolvedAt: ts("resolved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ───────────────────────────── Organisation & governance ─────────────────────────────

export const businessUnits = pgTable("business_units", {
  ...common(),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  revenueTargetMinor: money("revenue_target_minor"),
});

export const legalEntities = pgTable("legal_entities", {
  ...common(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("company"), // company | spv | partnership
  companyNumber: text("company_number"),
  jurisdiction: text("jurisdiction").default("England & Wales"),
  businessUnitId: uuid("business_unit_id"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
});

export const strategicInitiatives = pgTable("strategic_initiatives", {
  ...common(),
  name: text("name").notNull(),
  businessUnitId: uuid("business_unit_id"),
  ownerUserId: uuid("owner_user_id"),
  status: text("status").notNull().default("planned"),
  milestoneDate: date("milestone_date"),
  description: text("description"),
});

export const risks = pgTable("risks", {
  ...common(),
  productionId: uuid("production_id"),
  title: text("title").notNull(),
  category: text("category"),
  likelihood: integer("likelihood"),
  impact: integer("impact"),
  ownerUserId: uuid("owner_user_id"),
  mitigation: text("mitigation"),
  status: text("status").notNull().default("open"),
  reviewDate: date("review_date"),
});

/** KPI definitions. Values are computed from live data (metricKey) or entered with a dated source. */
export const kpis = pgTable("kpis", {
  ...common(),
  name: text("name").notNull(),
  definition: text("definition"),
  metricKey: text("metric_key"),
  unit: text("unit"),
  target: text("target"),
  manualValue: text("manual_value"),
  manualValueAsOf: date("manual_value_as_of"),
  period: text("period"),
  ownerUserId: uuid("owner_user_id"),
});

export const decisions = pgTable("decisions", {
  ...common(),
  title: text("title").notNull(),
  decidedOn: date("decided_on"),
  context: text("context"),
  decision: text("decision"),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  ownerUserId: uuid("owner_user_id"),
});

export const meetings = pgTable("meetings", {
  ...common(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("production"), // board | production | creative | commercial
  heldAt: ts("held_at"),
  productionId: uuid("production_id"),
  notes: text("notes"),
});

export const territories = pgTable("territories", {
  ...common(),
  name: text("name").notNull(),
  code: text("code"),
  region: text("region"),
  notes: text("notes"),
});

// ───────────────────────────── People & companies ─────────────────────────────

export const companies = pgTable("companies", {
  ...common(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("supplier"), // supplier | broadcaster | distributor | sponsor | agency | partner | investor | platform
  website: text("website"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
});

/** One person, many roles across productions (via engagements). Never deduplicate by name alone. */
export const people = pgTable("people", {
  ...common(),
  fullName: text("full_name").notNull(),
  preferredName: text("preferred_name"),
  pronouns: text("pronouns"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  companyId: uuid("company_id"),
  agentName: text("agent_name"),
  agentEmail: text("agent_email"),
  defaultDepartment: text("default_department"),
  dietary: text("dietary"),
  emergencyContact: text("emergency_contact"),
  notes: text("notes"),
}, (t) => [index("people_name").on(t.orgId, t.fullName)]);

export const availabilityBlocks = pgTable("availability_blocks", {
  ...common(),
  personId: uuid("person_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  kind: text("kind").notNull().default("unavailable"), // unavailable | hold | booked
  note: text("note"),
});

// ───────────────────────────── IP / development ─────────────────────────────

export const ipProjects = pgTable("ip_projects", {
  ...common(),
  businessUnitId: uuid("business_unit_id"),
  legalEntityId: uuid("legal_entity_id"),
  title: text("title").notNull(),
  logline: text("logline"),
  formatType: text("format_type").notNull().default("scripted_series"),
  genre: text("genre"),
  stage: text("stage").notNull().default("idea"),
  ownerUserId: uuid("owner_user_id"),
  targetBudgetMinor: money("target_budget_minor"),
  currency: text("currency").notNull().default("GBP"),
  rightsStatus: text("rights_status").default("unknown"),
  nextMilestone: text("next_milestone"),
  nextMilestoneDate: date("next_milestone_date"),
  decisionDate: date("decision_date"),
  synopsis: text("synopsis"),
  notes: text("notes"),
});

export const developmentMaterials = pgTable("development_materials", {
  ...common(),
  ipProjectId: uuid("ip_project_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("treatment"),
  versionLabel: text("version_label"),
  status: text("status").notNull().default("draft"),
  externalUrl: text("external_url"),
  /** Pinned approved SWDR revision reference (integration boundary). */
  swdrRevisionRef: text("swdr_revision_ref"),
  notes: text("notes"),
});

export const creativeReviews = pgTable("creative_reviews", {
  ...common(),
  ipProjectId: uuid("ip_project_id").notNull(),
  reviewer: text("reviewer"),
  kind: text("kind").notNull().default("coverage"),
  rating: integer("rating"),
  recommendation: text("recommendation"),
  summary: text("summary"),
  reviewedOn: date("reviewed_on"),
});

export const packagingItems = pgTable("packaging_items", {
  ...common(),
  ipProjectId: uuid("ip_project_id").notNull(),
  kind: text("kind").notNull().default("talent"), // talent | director | writer | broadcaster | partner | financier
  name: text("name").notNull(),
  personId: uuid("person_id"),
  companyId: uuid("company_id"),
  status: text("status").notNull().default("target"),
  notes: text("notes"),
});

export const greenlightGates = pgTable("greenlight_gates", {
  ...common(),
  ipProjectId: uuid("ip_project_id").notNull(),
  gate: text("gate").notNull(), // concept | development | packaging | greenlight
  status: text("status").notNull().default("pending"),
  dueDate: date("due_date"),
  decision: text("decision"),
  decidedOn: date("decided_on"),
  approvalRequestId: uuid("approval_request_id"),
  notes: text("notes"),
});

// ───────────────────────────── Approvals ─────────────────────────────

export const approvalRequests = pgTable("approval_requests", {
  ...common(),
  productionId: uuid("production_id"),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  kind: text("kind").notNull(), // budget | purchase_order | expense | greenlight | contract | delivery | release | rights
  title: text("title").notNull(),
  amountMinor: money("amount_minor"),
  currency: text("currency").default("GBP"),
  requiredRole: text("required_role").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | withdrawn
  requestedBy: uuid("requested_by"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  historical: boolean("historical").notNull().default(false),
}, (t) => [index("approvals_status").on(t.orgId, t.status)]);

export const approvalDecisions = pgTable("approval_decisions", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  approvalRequestId: uuid("approval_request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull(),
  actorRole: text("actor_role").notNull(),
  decision: text("decision").notNull(),
  note: text("note"),
  at: ts("at").notNull().defaultNow(),
});

// ───────────────────────────── Productions hierarchy ─────────────────────────────

export const productions = pgTable("productions", {
  ...common(),
  ipProjectId: uuid("ip_project_id"),
  businessUnitId: uuid("business_unit_id"),
  legalEntityId: uuid("legal_entity_id"),
  title: text("title").notNull(),
  code: text("code"),
  kind: text("kind").notNull().default("series"), // series | film | commercial | documentary | gameshow | panel_show | podcast | studio_unscripted
  status: text("status").notNull().default("pre_production"),
  usesEpisodes: boolean("uses_episodes").notNull().default(true),
  startDate: date("start_date"),
  endDate: date("end_date"),
  timezone: text("timezone").notNull().default("Europe/London"),
  currency: text("currency").notNull().default("GBP"),
  baseLocation: text("base_location"),
  description: text("description"),
  isLegacyImport: boolean("is_legacy_import").notNull().default(false),
  /** Production-level terminology and template provenance, e.g. { terms: { item: "Round", items: "Running order" }, template: "gameshow" }. */
  settings: jsonb("settings").$type<{ terms?: { unit?: string; units?: string; item?: string; items?: string }; template?: string }>().notNull().default({}),
});

export const productionMembers = pgTable("production_members", {
  orgId: uuid("org_id").notNull(),
  productionId: uuid("production_id").notNull().references(() => productions.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.productionId, t.userId] })]);

export const seasons = pgTable("seasons", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  number: integer("number").notNull(),
  title: text("title"),
}, (t) => [uniqueIndex("seasons_prod_num").on(t.productionId, t.number)]);

export const episodes = pgTable("episodes", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  seasonId: uuid("season_id"),
  number: integer("number"),
  code: text("code"),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("episode"), // episode | unit | standalone | pilot | special
  status: text("status").notNull().default("development"),
  synopsis: text("synopsis"),
  /** Original imported creative text kept side-by-side; never silently rewritten. */
  synopsisOriginal: text("synopsis_original"),
  runningTimeMins: integer("running_time_mins"),
  shootStart: date("shoot_start"),
  shootEnd: date("shoot_end"),
  deliveryDate: date("delivery_date"),
  txDate: date("tx_date"),
}, (t) => [index("episodes_prod").on(t.productionId)]);

export const locations = pgTable("locations", {
  ...common(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("location"), // location | studio | stage | facility | unit_base
  address: text("address"),
  postcode: text("postcode"),
  what3words: text("what3words"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  parking: text("parking"),
  accessNotes: text("access_notes"),
  nearestHospital: text("nearest_hospital"),
  status: text("status").notNull().default("scouted"), // scouted | hold | confirmed | cleared | unavailable
  permitRequired: boolean("permit_required").notNull().default(false),
  dailyCostMinor: money("daily_cost_minor"),
  allowsSharedUse: boolean("allows_shared_use").notNull().default(false),
  notes: text("notes"),
});

/** Props, wardrobe, equipment, sets, vehicles, graphics — one shared bookable resource table. */
export const resources = pgTable("resources", {
  ...common(),
  kind: text("kind").notNull(), // prop | wardrobe | equipment | set | vehicle | graphics
  name: text("name").notNull(),
  category: text("category"),
  quantity: integer("quantity").notNull().default(1),
  supplierCompanyId: uuid("supplier_company_id"),
  serialNumber: text("serial_number"),
  characterName: text("character_name"),
  size: text("size"),
  status: text("status").notNull().default("available"), // available | booked | checked_out | maintenance | lost | retired
  dailyRateMinor: money("daily_rate_minor"),
  productionId: uuid("production_id"),
  notes: text("notes"),
}, (t) => [index("resources_kind").on(t.orgId, t.kind)]);

export const resourceCheckouts = pgTable("resource_checkouts", {
  ...common(),
  resourceId: uuid("resource_id").notNull(),
  personId: uuid("person_id"),
  productionId: uuid("production_id"),
  outAt: ts("out_at").notNull().defaultNow(),
  dueAt: ts("due_at"),
  inAt: ts("in_at"),
  conditionOut: text("condition_out"),
  conditionIn: text("condition_in"),
});

/** Scenes (scripted) and segments (unscripted / panel / gameshow / running-order blocks). */
export const scenes = pgTable("scenes", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  kind: text("kind").notNull().default("scene"), // scene | segment | round | interview | performance | link | ad_break | vt | titles
  number: text("number").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  title: text("title").notNull(),
  intExt: text("int_ext"),
  dayNight: text("day_night"),
  locationId: uuid("location_id"),
  description: text("description"),
  director: text("director"),
  directorNotes: text("director_notes"),
  scriptRevisionRef: text("script_revision_ref"),
  pageEighths: integer("page_eighths"),
  estDurationMins: integer("est_duration_mins"),
  status: text("status").notNull().default("draft"), // draft | ready | scheduled | shot | in_post | complete | omitted
  specialRequirements: text("special_requirements"),
  cameraPlan: text("camera_plan"),
  graphicsNotes: text("graphics_notes"),
  audioNotes: text("audio_notes"),
}, (t) => [index("scenes_prod_ep").on(t.productionId, t.episodeId), uniqueIndex("scenes_unique_number").on(t.productionId, sql`coalesce(${t.episodeId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.number).where(sql`${t.archivedAt} is null`)]);

export const scenePeople = pgTable("scene_people", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  roleType: text("role_type").notNull().default("cast"), // cast | crew | guest | contestant | panellist | host | contributor
  characterName: text("character_name"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("scene_people_unique").on(t.sceneId, t.personId, t.roleType)]);

export const sceneResources = pgTable("scene_resources", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  sceneId: uuid("scene_id").notNull().references(() => scenes.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("scene_resources_unique").on(t.sceneId, t.resourceId)]);

export const shots = pgTable("shots", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  sceneId: uuid("scene_id").notNull(),
  number: text("number").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description"),
  shotType: text("shot_type"),
  framing: text("framing"),
  movement: text("movement"),
  lens: text("lens"),
  camera: text("camera"),
  priority: text("priority").notNull().default("must"), // must | should | nice
  estMinutes: integer("est_minutes"),
  status: text("status").notNull().default("planned"), // planned | shot | omitted
  notes: text("notes"),
  autoGenerated: boolean("auto_generated").notNull().default(false),
  /** Unique idempotency key for automation-created shots, e.g. "auto-initial:<sceneId>". */
  generationKey: text("generation_key"),
}, (t) => [index("shots_scene").on(t.sceneId), uniqueIndex("shots_generation_key").on(t.generationKey)]);

export const takes = pgTable("takes", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shotId: uuid("shot_id").notNull(),
  number: integer("number").notNull(),
  timecodeIn: text("timecode_in"),
  timecodeOut: text("timecode_out"),
  circled: boolean("circled").notNull().default(false),
  notes: text("notes"),
}, (t) => [uniqueIndex("takes_shot_num").on(t.shotId, t.number)]);

export const shootDays = pgTable("shoot_days", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  unit: text("unit").notNull().default("Main Unit"),
  date: date("date").notNull(),
  dayNumber: integer("day_number"),
  status: text("status").notNull().default("planned"), // planned | confirmed | wrapped | cancelled
  generalCall: time("general_call"),
  estWrap: time("est_wrap"),
  baseLocationId: uuid("base_location_id"),
  unitBaseNotes: text("unit_base_notes"),
  weatherNote: text("weather_note"),
  sunrise: text("sunrise"),
  sunset: text("sunset"),
  safetyNotes: text("safety_notes"),
  notes: text("notes"),
}, (t) => [index("shoot_days_date").on(t.orgId, t.date), index("shoot_days_prod").on(t.productionId, t.date)]);

export const scheduleBlocks = pgTable("schedule_blocks", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shootDayId: uuid("shoot_day_id").notNull(),
  kind: text("kind").notNull().default("scene"), // scene | travel | meal | setup | company_move | rehearsal | other
  sceneId: uuid("scene_id"),
  label: text("label"),
  startTime: time("start_time"),
  endTime: time("end_time"),
  locationId: uuid("location_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
}, (t) => [index("blocks_day").on(t.shootDayId)]);

/** Person-level call for a day (cast/crew call times). */
export const dayCalls = pgTable("day_calls", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shootDayId: uuid("shoot_day_id").notNull(),
  personId: uuid("person_id").notNull(),
  roleType: text("role_type").notNull().default("crew"),
  roleTitle: text("role_title"),
  callTime: time("call_time"),
  onSetTime: time("on_set_time"),
  pickupTime: time("pickup_time"),
  confirmed: boolean("confirmed").notNull().default(false),
  checkedInAt: ts("checked_in_at"),
  notes: text("notes"),
}, (t) => [uniqueIndex("day_calls_unique").on(t.shootDayId, t.personId)]);

export const resourceBookings = pgTable("resource_bookings", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  shootDayId: uuid("shoot_day_id"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("hold"), // hold | confirmed | released
  notes: text("notes"),
});

export const locationBookings = pgTable("location_bookings", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  locationId: uuid("location_id").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: text("status").notNull().default("hold"), // hold | confirmed | released
  costMinor: money("cost_minor"),
  notes: text("notes"),
});

export const transportBookings = pgTable("transport_bookings", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shootDayId: uuid("shoot_day_id"),
  kind: text("kind").notNull().default("minibus"),
  pickupLocation: text("pickup_location"),
  dropoffLocation: text("dropoff_location"),
  pickupTime: time("pickup_time"),
  driver: text("driver"),
  vehicle: text("vehicle"),
  passengers: text("passengers"),
  costMinor: money("cost_minor"),
  notes: text("notes"),
});

export const cateringOrders = pgTable("catering_orders", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shootDayId: uuid("shoot_day_id"),
  supplierCompanyId: uuid("supplier_company_id"),
  meal: text("meal").notNull().default("lunch"),
  serveTime: time("serve_time"),
  headcount: integer("headcount"),
  dietaryNotes: text("dietary_notes"),
  costMinor: money("cost_minor"),
  notes: text("notes"),
});

/** Immutable once issued: snapshot holds the full rendered plan at issue time. */
export const callSheets = pgTable("call_sheets", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  shootDayId: uuid("shoot_day_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  status: text("status").notNull().default("draft"), // draft | issued | superseded
  snapshot: jsonb("snapshot").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  issuedAt: ts("issued_at"),
  issuedBy: uuid("issued_by"),
  notes: text("notes"),
}, (t) => [uniqueIndex("call_sheets_version").on(t.shootDayId, t.versionNumber)]);

// ───────────────────────────── Engagements, contracts, releases ─────────────────────────────

export const engagements = pgTable("engagements", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  personId: uuid("person_id").notNull(),
  kind: text("kind").notNull().default("crew"), // cast | crew | guest | contestant | panellist | presenter | contributor
  roleTitle: text("role_title"),
  department: text("department"),
  characterName: text("character_name"),
  status: text("status").notNull().default("proposed"), // proposed | offered | confirmed | released | cancelled
  rateMinor: money("rate_minor"),
  rateUnit: text("rate_unit"), // day | week | flat | episode
  feeTotalMinor: money("fee_total_minor"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  contractStatus: text("contract_status").notNull().default("none"), // none | draft | generated | sent | signed | blocked
  detailsEmailSentAt: ts("details_email_sent_at"),
  notes: text("notes"),
}, (t) => [index("engagements_prod").on(t.productionId), uniqueIndex("engagements_unique").on(t.productionId, t.personId, t.kind, sql`coalesce(${t.roleTitle}, '')`).where(sql`${t.archivedAt} is null`)]);

export const contracts = pgTable("contracts", {
  ...common(),
  productionId: uuid("production_id"),
  ipProjectId: uuid("ip_project_id"),
  engagementId: uuid("engagement_id"),
  counterpartyPersonId: uuid("counterparty_person_id"),
  counterpartyCompanyId: uuid("counterparty_company_id"),
  legalEntityId: uuid("legal_entity_id"),
  kind: text("kind").notNull().default("crew"), // cast | crew | location | licence | sponsorship | distribution | chain_of_title | nda | services | other
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | generated | approved | sent | signed | countersigned | expired | terminated | blocked
  valueMinor: money("value_minor"),
  currency: text("currency").default("GBP"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  signedAt: ts("signed_at"),
  signatureEvidenceAttachmentId: uuid("signature_evidence_attachment_id"),
  providerRef: text("provider_ref"),
  notes: text("notes"),
});

export const contractObligations = pgTable("contract_obligations", {
  ...common(),
  contractId: uuid("contract_id").notNull(),
  productionId: uuid("production_id"),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  ownerUserId: uuid("owner_user_id"),
  status: text("status").notNull().default("open"), // open | met | breached | waived
});

export const releaseForms = pgTable("release_forms", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  personId: uuid("person_id"),
  sceneId: uuid("scene_id"),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("appearance"), // appearance | location | minor | materials | music
  status: text("status").notNull().default("required"), // required | sent | signed | refused | missing
  signedAt: ts("signed_at"),
  notes: text("notes"),
});

// ───────────────────────────── Money ─────────────────────────────

export const budgets = pgTable("budgets", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  name: text("name").notNull(),
  versionLabel: text("version_label").notNull().default("v1"),
  status: text("status").notNull().default("draft"), // draft | submitted | approved | locked
  currency: text("currency").notNull().default("GBP"),
  approvedAt: ts("approved_at"),
  approvedBy: uuid("approved_by"),
});

export const budgetLines = pgTable("budget_lines", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  budgetId: uuid("budget_id").notNull(),
  episodeId: uuid("episode_id"),
  code: text("code"),
  category: text("category").notNull(),
  description: text("description"),
  estimateMinor: money("estimate_minor").notNull().default(0),
  approvedMinor: money("approved_minor").notNull().default(0),
  forecastMinor: money("forecast_minor"),
  vatRateBp: integer("vat_rate_bp").notNull().default(2000), // basis points: 2000 = 20%
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("budget_lines_budget").on(t.budgetId)]);

export const purchaseOrders = pgTable("purchase_orders", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  budgetLineId: uuid("budget_line_id"),
  supplierCompanyId: uuid("supplier_company_id"),
  number: text("number").notNull(),
  description: text("description").notNull(),
  netMinor: money("net_minor").notNull(),
  vatMinor: money("vat_minor").notNull().default(0),
  status: text("status").notNull().default("draft"), // draft | pending_approval | approved | rejected | closed
  approvalRequestId: uuid("approval_request_id"),
}, (t) => [uniqueIndex("po_number").on(t.orgId, t.number)]);

export const expenses = pgTable("expenses", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  budgetLineId: uuid("budget_line_id"),
  purchaseOrderId: uuid("purchase_order_id"),
  supplier: text("supplier"),
  claimantPersonId: uuid("claimant_person_id"),
  description: text("description").notNull(),
  incurredOn: date("incurred_on"),
  netMinor: money("net_minor").notNull(),
  vatMinor: money("vat_minor").notNull().default(0),
  status: text("status").notNull().default("submitted"), // draft | submitted | approved | rejected | paid
  approvalRequestId: uuid("approval_request_id"),
});

export const fundingSources = pgTable("funding_sources", {
  ...common(),
  productionId: uuid("production_id"),
  ipProjectId: uuid("ip_project_id"),
  legalEntityId: uuid("legal_entity_id"),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("equity"), // equity | debt | presale | incentive | grant | sponsor | capital_pool | founder_advance
  counterpartyCompanyId: uuid("counterparty_company_id"),
  amountMinor: money("amount_minor"),
  currency: text("currency").default("GBP"),
  status: text("status").notNull().default("target"), // target | soft | committed | closed | received | lapsed
  expectedDate: date("expected_date"),
  notes: text("notes"),
});

// ───────────────────────────── Post & delivery ─────────────────────────────

export const mediaAssets = pgTable("media_assets", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  sceneId: uuid("scene_id"),
  shotId: uuid("shot_id"),
  shootDayId: uuid("shoot_day_id"),
  kind: text("kind").notNull().default("rushes"), // rushes | audio | graphics | edit | still | music | document
  label: text("label").notNull(),
  attachmentId: uuid("attachment_id"),
  externalRef: text("external_ref"),
  durationSecs: integer("duration_secs"),
  checksum: text("checksum"),
  ingestStatus: text("ingest_status").notNull().default("pending"), // pending | ingested | verified | failed
});

export const postTasks = pgTable("post_tasks", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  sceneId: uuid("scene_id"),
  kind: text("kind").notNull().default("edit"), // ingest | edit | assembly | offline | online | grade | sound | music | graphics | vfx | subtitles | qc | delivery
  title: text("title").notNull(),
  assigneePersonId: uuid("assignee_person_id"),
  status: text("status").notNull().default("todo"), // todo | in_progress | review | done | blocked
  dueDate: date("due_date"),
  notes: text("notes"),
  /** Idempotency key for system-created tasks (e.g. "wrap-ingest:<shootDayId>"). */
  generationKey: text("generation_key"),
}, (t) => [index("post_tasks_prod").on(t.productionId, t.status), uniqueIndex("post_tasks_generation_key").on(t.generationKey)]);

export const editVersions = pgTable("edit_versions", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  postTaskId: uuid("post_task_id"),
  versionLabel: text("version_label").notNull(),
  kind: text("kind").notNull().default("rough_cut"), // assembly | rough_cut | fine_cut | picture_lock | online | final
  mediaAssetId: uuid("media_asset_id"),
  reviewUrl: text("review_url"),
  status: text("status").notNull().default("in_review"), // in_review | changes_requested | approved
  submittedAt: ts("submitted_at").notNull().defaultNow(),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
});

export const reviewComments = pgTable("review_comments", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  editVersionId: uuid("edit_version_id").notNull(),
  timecode: text("timecode"),
  body: text("body").notNull(),
  resolved: boolean("resolved").notNull().default(false),
});

export const deliverables = pgTable("deliverables", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  contractId: uuid("contract_id"),
  title: text("title").notNull(),
  spec: text("spec"),
  destinationCompanyId: uuid("destination_company_id"),
  dueDate: date("due_date"),
  status: text("status").notNull().default("pending"), // pending | in_progress | qc | ready_for_approval | approved | delivered | rejected
  requiresRightsClearance: boolean("requires_rights_clearance").notNull().default(true),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  deliveredAt: ts("delivered_at"),
  notes: text("notes"),
});

export const releases = pgTable("releases", {
  ...common(),
  productionId: uuid("production_id").notNull(),
  episodeId: uuid("episode_id"),
  channelCompanyId: uuid("channel_company_id"),
  platform: text("platform"),
  territory: text("territory"),
  releaseDate: date("release_date"),
  windowEnd: date("window_end"),
  status: text("status").notNull().default("planned"), // planned | scheduled | released | cancelled
  notes: text("notes"),
});

// ───────────────────────────── Rights & commercial ─────────────────────────────

export const rightsEntries = pgTable("rights_entries", {
  ...common(),
  ipProjectId: uuid("ip_project_id"),
  productionId: uuid("production_id"),
  title: text("title").notNull(),
  rightType: text("right_type").notNull().default("underlying"), // underlying | format | script | music | footage | talent | location | trademark | likeness
  grantor: text("grantor"),
  granteeLegalEntityId: uuid("grantee_legal_entity_id"),
  territories: text("territories"),
  media: text("media"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  exclusive: boolean("exclusive").notNull().default(false),
  restrictions: text("restrictions"),
  status: text("status").notNull().default("pending"), // cleared | pending | missing | expired | disputed
  contractId: uuid("contract_id"),
  evidenceNote: text("evidence_note"),
});

export const licenceWindows = pgTable("licence_windows", {
  ...common(),
  productionId: uuid("production_id"),
  ipProjectId: uuid("ip_project_id"),
  rightsEntryId: uuid("rights_entry_id"),
  licenseeCompanyId: uuid("licensee_company_id"),
  territory: text("territory"),
  media: text("media"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  exclusive: boolean("exclusive").notNull().default(false),
  feeMinor: money("fee_minor"),
  currency: text("currency").default("GBP"),
  status: text("status").notNull().default("proposed"), // proposed | negotiating | signed | active | expired
});

export const salesOpportunities = pgTable("sales_opportunities", {
  ...common(),
  productionId: uuid("production_id"),
  ipProjectId: uuid("ip_project_id"),
  buyerCompanyId: uuid("buyer_company_id"),
  title: text("title").notNull(),
  territory: text("territory"),
  rightsType: text("rights_type"),
  stage: text("stage").notNull().default("lead"), // lead | pitched | negotiating | won | lost
  valueMinor: money("value_minor"),
  currency: text("currency").default("GBP"),
  probabilityPct: integer("probability_pct"),
  expectedClose: date("expected_close"),
  notes: text("notes"),
});

export const sponsorDeals = pgTable("sponsor_deals", {
  ...common(),
  productionId: uuid("production_id"),
  companyId: uuid("company_id"),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("sponsorship"), // sponsorship | brand_integration | product_placement | partnership | marketing
  valueMinor: money("value_minor"),
  currency: text("currency").default("GBP"),
  stage: text("stage").notNull().default("lead"), // lead | negotiating | contracted | delivering | complete | lost
  startDate: date("start_date"),
  endDate: date("end_date"),
  obligations: text("obligations"),
  contractId: uuid("contract_id"),
});

export const commercialDeliverables = pgTable("commercial_deliverables", {
  ...common(),
  sponsorDealId: uuid("sponsor_deal_id").notNull(),
  productionId: uuid("production_id"),
  episodeId: uuid("episode_id"),
  sceneId: uuid("scene_id"),
  description: text("description").notNull(),
  dueDate: date("due_date"),
  status: text("status").notNull().default("pending"), // pending | scheduled | delivered | verified | missed
});

// ───────────────────────────── Operations & workflows ─────────────────────────────

export const tasks = pgTable("tasks", {
  ...common(),
  productionId: uuid("production_id"),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  title: text("title").notNull(),
  description: text("description"),
  assigneeUserId: uuid("assignee_user_id"),
  status: text("status").notNull().default("todo"), // todo | doing | blocked | done
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  dueDate: date("due_date"),
}, (t) => [index("tasks_status").on(t.orgId, t.status)]);

export const sops = pgTable("sops", {
  ...common(),
  title: text("title").notNull(),
  category: text("category"),
  body: text("body"),
  ownerUserId: uuid("owner_user_id"),
  versionLabel: text("version_label").default("v1"),
  status: text("status").notNull().default("draft"), // draft | approved | retired
});

export const workflowDefinitions = pgTable("workflow_definitions", {
  ...common(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  source: text("source").notNull(), // native | sappening_native | ovation_spec
  sourceRef: text("source_ref"),
  sourceDeployment: text("source_deployment"), // deployed | undeployed | spec_only
  triggerEvent: text("trigger_event"),
  conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
  action: text("action"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  status: text("status").notNull().default("draft"), // draft | approved | active | paused | retired
  disposition: text("disposition").notNull().default("blocked"), // implemented | paused | replaced | retired | blocked
  dispositionEvidence: text("disposition_evidence"),
  ruleVersion: integer("rule_version").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(5),
  ownerUserId: uuid("owner_user_id"),
  notes: text("notes"),
}, (t) => [uniqueIndex("workflow_key").on(t.orgId, t.key)]);

/** Transactional outbox. Written in the same transaction as the business change. */
export const outboxEvents = pgTable("outbox_events", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  type: text("type").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  productionId: uuid("production_id"),
  payload: jsonb("payload").notNull().default({}),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  origin: text("origin").notNull().default("user"), // user | import | system | api
  actorUserId: uuid("actor_user_id"),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  status: text("status").notNull().default("pending"), // pending | processing | done | failed | dead | suppressed
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lockedUntil: ts("locked_until"),
  lastError: text("last_error"),
  processedAt: ts("processed_at"),
}, (t) => [index("outbox_pending").on(t.status, t.nextAttemptAt)]);

export const workflowRuns = pgTable("workflow_runs", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  workflowKey: text("workflow_key").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  eventId: uuid("event_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull().default("running"), // running | succeeded | skipped | failed | awaiting_approval | blocked
  attempts: integer("attempts").notNull().default(1),
  result: jsonb("result"),
  lastError: text("last_error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
}, (t) => [index("workflow_runs_key").on(t.orgId, t.workflowKey, t.startedAt)]);

/** Outbound communications. Never sent without explicit confirmation + configured provider. */
export const outboundMessages = pgTable("outbound_messages", {
  ...common(),
  productionId: uuid("production_id"),
  channel: text("channel").notNull().default("email"),
  template: text("template").notNull(),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  toPersonId: uuid("to_person_id"),
  toAddress: text("to_address"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("draft"), // draft | awaiting_confirmation | queued | sent | failed | blocked_no_provider | cancelled
  idempotencyKey: text("idempotency_key").notNull(),
  confirmedBy: uuid("confirmed_by"),
  confirmedAt: ts("confirmed_at"),
  attempts: integer("attempts").notNull().default(0),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  sentAt: ts("sent_at"),
}, (t) => [uniqueIndex("outbound_idem").on(t.orgId, t.idempotencyKey)]);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
/** File bytes for the `db` storage driver (small deployments without S3). Metadata stays in `attachments`. */
export const fileBlobs = pgTable("file_blobs", {
  storageKey: text("storage_key").primaryKey(),
  bytes: bytea("bytes").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ───────────── Customisation ─────────────

export interface OrgSettings {
  currency?: string;
  timezone?: string;
  defaultVatBp?: number;
  /** Gross spend limits (minor units): below pmLimit → PM, below producerLimit → producer, else executive. */
  approval?: { pmLimitMinor?: number; producerLimitMinor?: number };
  callSheetContactPolicy?: string;
  /** Rename entities in the UI, e.g. { scenes: { label: "Item", plural: "Items" } }. */
  terminology?: Record<string, { label?: string; plural?: string }>;
  /** Extra options for extensible select fields, keyed "entity.field". */
  options?: Record<string, string[]>;
  departments?: string[];
}

/** Per-organisation user-defined fields on any registered entity. */
export const customFieldDefs = pgTable("custom_field_defs", {
  ...common(),
  entity: text("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type").notNull(), // text | textarea | number | money | date | bool | select | url
  options: jsonb("options").$type<string[]>().notNull().default([]),
  required: boolean("required").notNull().default(false),
  showInList: boolean("show_in_list").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  help: text("help"),
}, (t) => [uniqueIndex("custom_field_key").on(t.orgId, t.entity, t.key)]);

export const customFieldValues = pgTable("custom_field_values", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  recordId: uuid("record_id").notNull(),
  fieldId: uuid("field_id").notNull().references(() => customFieldDefs.id, { onDelete: "cascade" }),
  value: jsonb("value"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
}, (t) => [uniqueIndex("custom_value_unique").on(t.recordId, t.fieldId), index("custom_value_entity").on(t.orgId, t.entity, t.recordId)]);

/** Reusable production blueprints (built-in catalogue is in code; these are org-saved). */
export const productionTemplates = pgTable("production_templates", {
  ...common(),
  name: text("name").notNull(),
  description: text("description"),
  baseKind: text("base_kind").notNull(),
  blueprint: jsonb("blueprint").notNull(),
});

// ═════════════════════════ Platform: no-code bases (Airtable-class) ═════════════════════════

/** Workspace-level role for the base platform. commenter/reader are free (non-editing) seats. */
export const PLATFORM_ROLES = ["owner", "creator", "editor", "commenter", "reader"] as const;

export const bases = pgTable("bases", {
  ...common(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").notNull().default("grid"),
  color: text("color").notNull().default("blue"),
  templateKey: text("template_key"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** Per-base role overrides (Airtable "base collaborators"). */
export const baseMembers = pgTable("base_members", {
  orgId: uuid("org_id").notNull(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.baseId, t.userId] })]);

export interface TablePermissions { create?: string; edit?: string; delete?: string }
export const baseTables = pgTable("base_tables", {
  ...common(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  primaryFieldId: uuid("primary_field_id"),
  autonumberSeq: integer("autonumber_seq").notNull().default(0),
  /** Minimum role per action, e.g. { create: "editor", delete: "creator" }. */
  permissions: jsonb("permissions").$type<TablePermissions>().notNull().default({}),
}, (t) => [index("base_tables_base").on(t.baseId)]);

export interface FieldPermissions { edit?: string; hiddenBelow?: string }
export const baseFields = pgTable("base_fields", {
  ...common(),
  tableId: uuid("table_id").notNull().references(() => baseTables.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  options: jsonb("options").$type<import("@/lib/platform/fields").FieldOptions>().notNull().default({}),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Minimum role to edit; minimum role to see (fields hidden below it). */
  permissions: jsonb("permissions").$type<FieldPermissions>().notNull().default({}),
}, (t) => [index("base_fields_table").on(t.tableId)]);

export const baseRecords = pgTable("base_records", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").notNull().references(() => baseTables.id, { onDelete: "cascade" }),
  /** Cell values keyed by field id. Computed fields are never stored. */
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  rowColor: text("row_color"),
  autonumber: integer("autonumber").notNull(),
  sortOrder: doublePrecision("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
  deletedAt: ts("deleted_at"),
  sourceRef: text("source_ref"),
}, (t) => [index("base_records_table").on(t.tableId, t.deletedAt), uniqueIndex("base_records_source").on(t.tableId, t.sourceRef)]);

export interface ViewConfig {
  filters?: { conjunction: "and" | "or"; conditions: { fieldId: string; op: string; value?: unknown }[] };
  sorts?: { fieldId: string; dir: "asc" | "desc" }[];
  groups?: { fieldId: string; dir: "asc" | "desc" }[];
  hidden?: string[];
  order?: string[];
  widths?: Record<string, number>;
  frozen?: number;
  rowHeight?: "short" | "medium" | "tall" | "extra";
  color?: { mode: "none" | "select" | "conditions"; fieldId?: string; rules?: { color: string; fieldId: string; op: string; value?: unknown }[] };
  kanbanFieldId?: string; dateFieldId?: string; endDateFieldId?: string; coverFieldId?: string; titleFieldId?: string;
  form?: { title?: string; description?: string; fields?: { fieldId: string; required?: boolean; help?: string }[]; submitLabel?: string; successMessage?: string; isPublic?: boolean };
  summaries?: Record<string, string>;
}
export const baseViews = pgTable("base_views", {
  ...common(),
  tableId: uuid("table_id").notNull().references(() => baseTables.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("grid"), // grid | kanban | calendar | gallery | form | timeline | list
  config: jsonb("config").$type<ViewConfig>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Null = collaborative view; a user id = that user's personal view. */
  ownerUserId: uuid("owner_user_id"),
  isLocked: boolean("is_locked").notNull().default(false),
  /** Minimum role that can see this view. */
  visibleTo: text("visible_to"),
  shareToken: text("share_token").unique(),
}, (t) => [index("base_views_table").on(t.tableId)]);

export const recordComments = pgTable("record_comments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  recordId: uuid("record_id").notNull().references(() => baseRecords.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
  createdBy: uuid("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
}, (t) => [index("record_comments_record").on(t.recordId)]);

/** Cell-level revision history per record. */
export const recordRevisions = pgTable("record_revisions", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  recordId: uuid("record_id").notNull(),
  tableId: uuid("table_id").notNull(),
  action: text("action").notNull(), // create | update | delete | restore
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull().default({}),
  actorUserId: uuid("actor_user_id"),
  actorLabel: text("actor_label"),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("record_revisions_record").on(t.recordId, t.at)]);

/** Interfaces: dashboards made of widgets (charts, numbers, record lists). */
export const baseInterfaces = pgTable("base_interfaces", {
  ...common(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  widgets: jsonb("widgets").$type<Record<string, unknown>[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const baseAutomations = pgTable("base_automations", {
  ...common(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
  actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull().default([]),
  lastRunAt: ts("last_run_at"),
  /** Secret path token for inbound-webhook triggers (rotatable). */
  webhookToken: text("webhook_token").unique(),
  lastScheduledAt: ts("last_scheduled_at"),
  runCount: integer("run_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
});

/** External data syncs into a table (Airtable, CSV URL, another base table). Secrets are encrypted at rest. */
export const syncSources = pgTable("sync_sources", {
  ...common(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").references(() => baseTables.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  secretCipher: text("secret_cipher"),
  intervalMinutes: integer("interval_minutes"),
  status: text("status").notNull().default("idle"),
  lastSyncedAt: ts("last_synced_at"),
  lastError: text("last_error"),
  lastStats: jsonb("last_stats").$type<Record<string, unknown>>(),
});

/** Per-organisation OpenID Connect single sign-on. The client secret is AES-GCM encrypted. */
export const ssoConfigs = pgTable("sso_configs", {
  orgId: uuid("org_id").primaryKey().references(() => organisations.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretCipher: text("client_secret_cipher"),
  allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
  defaultRole: text("default_role").notNull().default("reader"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  enforce: boolean("enforce").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

/** In-app AI agents for a base: instructions + tools scoped to tables; acts with the chatting user's permissions. */
export const baseAgents = pgTable("base_agents", {
  ...common(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("🤖"),
  color: text("color").notNull().default("blue"),
  role: text("role"),
  instructions: text("instructions").notNull().default(""),
  tableIds: jsonb("table_ids").$type<string[]>().notNull().default([]),
  canPropose: boolean("can_propose").notNull().default(true),
});

export const agentThreads = pgTable("agent_threads", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  agentId: uuid("agent_id").notNull().references(() => baseAgents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  title: text("title").notNull().default("New conversation"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("agent_threads_agent_user").on(t.agentId, t.userId)]);

/** Append-only transcript; `content` holds the model's content blocks unchanged so they can be replayed. */
export const agentMessages = pgTable("agent_messages", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  threadId: uuid("thread_id").notNull().references(() => agentThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: jsonb("content").$type<unknown>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("agent_messages_thread").on(t.threadId, t.createdAt)]);

/** Human approval queue for agent-proposed writes and automation outbound requests. */
export const baseApprovals = pgTable("base_approvals", {
  id: id(),
  orgId: uuid("org_id").notNull(),
  baseId: uuid("base_id").notNull().references(() => bases.id, { onDelete: "cascade" }),
  source: text("source").notNull(), // agent | automation
  sourceId: uuid("source_id"),
  threadId: uuid("thread_id"),
  requestedBy: uuid("requested_by"),
  kind: text("kind").notNull(), // create_record | update_record | add_comment | webhook
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected | failed
  result: jsonb("result").$type<Record<string, unknown>>(),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("base_approvals_base_status").on(t.baseId, t.status)]);
