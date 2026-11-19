import { canRead, type Domain, type Role } from "./permissions";

export interface NavItem { href: string; label: string; icon: string; domain?: Domain; roles?: Role[]; section: string }

/** The 12 workspaces plus personal/admin areas. Visibility is cosmetic; the server enforces access. */
export const NAV: NavItem[] = [
  { href: "/", label: "Command Centre", icon: "home", section: "Overview", roles: ["org_admin", "executive", "producer", "production_manager", "department_head", "finance_legal", "post", "commercial"] },
  { href: "/my", label: "My schedule", icon: "clock", section: "Overview", roles: ["cast", "crew", "department_head", "production_manager", "producer"] },
  { href: "/approvals", label: "Approvals", icon: "check", section: "Overview", domain: "approvals" },
  { href: "/slate", label: "Slate & IP", icon: "slate", section: "Develop", domain: "slate" },
  { href: "/productions", label: "Productions", icon: "film", section: "Produce", domain: "production" },
  { href: "/schedule", label: "Schedule & shoot days", icon: "calendar", section: "Produce", domain: "production" },
  { href: "/people", label: "Cast, crew & talent", icon: "people", section: "Produce", domain: "people" },
  { href: "/resources", label: "Locations & resources", icon: "box", section: "Produce", domain: "resources" },
  { href: "/budgets", label: "Budgets & spend", icon: "money", section: "Business", domain: "finance" },
  { href: "/post", label: "Post & delivery", icon: "post", section: "Deliver", domain: "review" },
  { href: "/rights", label: "Rights & contracts", icon: "rights", section: "Business", domain: "legal" },
  { href: "/commercial", label: "Commercial & distribution", icon: "commercial", section: "Business", domain: "commercial" },
  { href: "/executive", label: "Governance", icon: "shield", section: "Business", domain: "org" },
  { href: "/operations", label: "Operations & tasks", icon: "ops", section: "Operate", domain: "ops" },
  { href: "/automations", label: "Automations", icon: "bolt", section: "Operate", domain: "automation" },
  { href: "/admin", label: "Admin & migration", icon: "settings", section: "Operate", domain: "admin" },
];

export function navFor(role: Role) {
  return NAV.filter((n) => (n.roles ? n.roles.includes(role) : true) && (n.domain ? canRead(role, n.domain) : true));
}

export function homeFor(role: Role) {
  if (role === "cast" || role === "crew") return "/my";
  if (role === "external_reviewer") return "/post";
  return "/";
}
