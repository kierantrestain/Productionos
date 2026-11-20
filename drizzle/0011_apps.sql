CREATE TABLE IF NOT EXISTS "apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "archived_at" timestamp with time zone,
  "base_id" uuid NOT NULL REFERENCES "bases"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "icon" text DEFAULT 'grid' NOT NULL,
  "color" text DEFAULT 'blue' NOT NULL,
  "description" text,
  "audience" text DEFAULT 'workspace' NOT NULL,
  "draft" jsonb NOT NULL,
  "draft_revision" integer DEFAULT 1 NOT NULL,
  "published_version_id" uuid,
  "template_key" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apps_org_slug" ON "apps" ("org_id","slug");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "apps"("id") ON DELETE cascade,
  "version" integer NOT NULL,
  "config" jsonb NOT NULL,
  "note" text,
  "published_by" uuid,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_versions_app_version" ON "app_versions" ("app_id","version");
