import type { Role } from "@/lib/permissions";
import type { OrgSettingsShape } from "@/lib/customise";

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
  settings: OrgSettingsShape;
  /** Role on the base platform (owner | creator | editor | commenter | reader). */
  platformRole: string;
}
