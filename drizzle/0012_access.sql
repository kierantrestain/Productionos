ALTER TABLE "bases" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'workspace' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "base_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id") ON DELETE cascade,
  "table_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "record_id" uuid,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "size" integer NOT NULL,
  "sha256" text NOT NULL,
  "storage_key" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_attachments_record" ON "base_attachments" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_records_table_sort" ON "base_records" ("table_id","sort_order") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_members_user" ON "base_members" ("user_id");
