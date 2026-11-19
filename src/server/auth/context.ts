import type { Role } from "@/lib/permissions";

/** Authenticated request context. Every service call takes one; nothing trusts the client. */
export interface Ctx {
  userId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  personId: string | null;
  /** "all" for global-production roles; otherwise the productions this user is a member of. */
  productionIds: "all" | string[];
  orgName: string;
  orgIsDemo: boolean;
}
