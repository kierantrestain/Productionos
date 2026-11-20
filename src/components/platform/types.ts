import type { ViewConfig } from "@/db/schema";
import type { FieldDefLite } from "@/lib/platform/fields";

export type Role = "owner" | "creator" | "editor" | "commenter" | "reader";
export interface ClientField extends FieldDefLite { tableId: string; editable: boolean; isPrimary: boolean }
export interface ClientView { id: string; name: string; type: string; config: ViewConfig; personal: boolean; isLocked: boolean; visibleTo: string | null; shareToken: string | null; canEdit: boolean }
export interface ClientRow { id: string; values: Record<string, unknown>; color: string | null; autonumber: number; createdAt: string; updatedAt: string }
export interface BaseData {
  base: { id: string; name: string; color: string; icon: string; description: string | null };
  role: Role;
  me: { id: string; name: string };
  tables: { id: string; name: string }[];
  table: { id: string; name: string; description: string | null; primaryFieldId: string | null; permissions: { create?: string; edit?: string; delete?: string } };
  allFields: ClientField[];       // every field of the table the caller may see (view-hidden ones included)
  views: ClientView[];
  view: ClientView;
  rows: ClientRow[];
  total: number;
  matched: number;          // rows matching the view (the grid loads the first page, then more on demand)
  commentCounts: Record<string, number>;
  collaborators: { id: string; name: string }[];
  baseFields: { id: string; name: string; type: string; tableId: string }[]; // every visible field in the base (lookups, rollups, formulas)
  can: { create: boolean; edit: boolean; delete: boolean; comment: boolean; schema: boolean; collabViews: boolean };
  aiConfigured: boolean;
}
