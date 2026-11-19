/**
 * Role-based access contract. Shared by server (enforcement) and client (visibility only —
 * the client is never trusted). Least privilege: anything not granted is denied.
 */
export const ROLES = [
  "org_admin", "executive", "producer", "production_manager", "department_head",
  "crew", "cast", "finance_legal", "post", "commercial", "external_reviewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  org_admin: "Organisation admin",
  executive: "Executive",
  producer: "Producer",
  production_manager: "Production manager",
  department_head: "Department head",
  crew: "Crew",
  cast: "Cast",
  finance_legal: "Finance / legal",
  post: "Post-production",
  commercial: "Commercial",
  external_reviewer: "External reviewer",
};

export const DOMAINS = [
  "org", "slate", "production", "people", "resources", "finance", "funding", "legal",
  "post", "review", "commercial", "ops", "automation", "approvals", "admin", "migration",
] as const;
export type Domain = (typeof DOMAINS)[number];

type Grant = { read: readonly Role[]; write: readonly Role[] };
const ALL_INTERNAL: Role[] = ["org_admin", "executive", "producer", "production_manager", "department_head", "crew", "finance_legal", "post", "commercial"];

export const DOMAIN_GRANTS: Record<Domain, Grant> = {
  org:        { read: ["org_admin", "executive", "finance_legal"], write: ["org_admin", "executive"] },
  slate:      { read: ["org_admin", "executive", "producer", "commercial", "finance_legal"], write: ["org_admin", "executive", "producer"] },
  production: { read: ["org_admin", "executive", "producer", "production_manager", "department_head", "crew", "post", "finance_legal", "commercial"], write: ["org_admin", "producer", "production_manager"] },
  people:     { read: ["org_admin", "executive", "producer", "production_manager", "department_head", "finance_legal"], write: ["org_admin", "producer", "production_manager"] },
  resources:  { read: ["org_admin", "executive", "producer", "production_manager", "department_head", "crew"], write: ["org_admin", "producer", "production_manager", "department_head"] },
  finance:    { read: ["org_admin", "executive", "producer", "production_manager", "finance_legal"], write: ["org_admin", "producer", "production_manager", "finance_legal"] },
  funding:    { read: ["org_admin", "executive", "finance_legal"], write: ["org_admin", "executive", "finance_legal"] },
  legal:      { read: ["org_admin", "executive", "producer", "production_manager", "finance_legal", "commercial"], write: ["org_admin", "producer", "production_manager", "finance_legal"] },
  post:       { read: ["org_admin", "executive", "producer", "production_manager", "post"], write: ["org_admin", "producer", "production_manager", "post"] },
  review:     { read: ["org_admin", "executive", "producer", "production_manager", "post", "external_reviewer"], write: ["org_admin", "producer", "production_manager", "post", "external_reviewer"] },
  commercial: { read: ["org_admin", "executive", "producer", "commercial", "finance_legal"], write: ["org_admin", "executive", "commercial"] },
  ops:        { read: ALL_INTERNAL, write: ALL_INTERNAL },
  automation: { read: ["org_admin", "executive", "producer", "production_manager"], write: ["org_admin"] },
  approvals:  { read: ["org_admin", "executive", "producer", "production_manager", "finance_legal"], write: ["org_admin", "executive", "producer", "production_manager", "finance_legal"] },
  admin:      { read: ["org_admin"], write: ["org_admin"] },
  migration:  { read: ["org_admin"], write: ["org_admin"] },
};

/** Department heads may write within these production sub-areas only. */
export const DEPT_HEAD_PRODUCTION_WRITE = new Set(["shots", "takes", "scene_resources", "resource_checkouts"]);

/** Roles that see every production in the organisation. Others see only productions they are members of. */
export const GLOBAL_PRODUCTION_ROLES: readonly Role[] = ["org_admin", "executive", "finance_legal", "commercial"];

/** Field-level sensitivity classes. */
export const SENSITIVE_READ: Record<"pii" | "rate" | "raw_source", readonly Role[]> = {
  pii: ["org_admin", "producer", "production_manager", "finance_legal"],
  rate: ["org_admin", "executive", "producer", "finance_legal"],
  raw_source: ["org_admin"],
};

/** Approval authority: which roles may decide an approval of a given required role. */
export const APPROVAL_AUTHORITY: Record<string, readonly Role[]> = {
  producer: ["producer", "executive", "org_admin"],
  production_manager: ["production_manager", "producer", "executive", "org_admin"],
  finance_legal: ["finance_legal", "org_admin"],
  executive: ["executive", "org_admin"],
};

export function canRead(role: Role, domain: Domain) { return DOMAIN_GRANTS[domain].read.includes(role); }
export function canWrite(role: Role, domain: Domain, entityKey?: string) {
  if (DOMAIN_GRANTS[domain].write.includes(role)) return true;
  return role === "department_head" && domain === "production" && !!entityKey && DEPT_HEAD_PRODUCTION_WRITE.has(entityKey);
}
export function canSee(role: Role, cls: keyof typeof SENSITIVE_READ) { return SENSITIVE_READ[cls].includes(role); }
export function isGlobalProductionRole(role: Role) { return GLOBAL_PRODUCTION_ROLES.includes(role); }
export function canDecide(role: Role, requiredRole: string) { return (APPROVAL_AUTHORITY[requiredRole] ?? ["org_admin"]).includes(role); }
