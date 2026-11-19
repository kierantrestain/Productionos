CREATE TABLE "base_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"trigger" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_interfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_members" (
	"org_id" uuid NOT NULL,
	"base_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_members_base_id_user_id_pk" PRIMARY KEY("base_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "base_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_color" text,
	"autonumber" integer NOT NULL,
	"sort_order" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"source_ref" text
);
--> statement-breakpoint
CREATE TABLE "base_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"base_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"primary_field_id" uuid,
	"autonumber_seq" integer DEFAULT 0 NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "base_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'grid' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"owner_user_id" uuid,
	"is_locked" boolean DEFAULT false NOT NULL,
	"visible_to" text,
	"share_token" text,
	CONSTRAINT "base_views_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'grid' NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "record_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"base_id" uuid NOT NULL,
	"table_id" uuid,
	"kind" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_cipher" text,
	"interval_minutes" integer,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"last_stats" jsonb
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "platform_role" text DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE "base_automations" ADD CONSTRAINT "base_automations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_automations" ADD CONSTRAINT "base_automations_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_fields" ADD CONSTRAINT "base_fields_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_fields" ADD CONSTRAINT "base_fields_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_interfaces" ADD CONSTRAINT "base_interfaces_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_interfaces" ADD CONSTRAINT "base_interfaces_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_members" ADD CONSTRAINT "base_members_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_members" ADD CONSTRAINT "base_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_records" ADD CONSTRAINT "base_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_records" ADD CONSTRAINT "base_records_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_tables" ADD CONSTRAINT "base_tables_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_tables" ADD CONSTRAINT "base_tables_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_views" ADD CONSTRAINT "base_views_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "base_views" ADD CONSTRAINT "base_views_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bases" ADD CONSTRAINT "bases_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_record_id_base_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."base_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_sources" ADD CONSTRAINT "sync_sources_table_id_base_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."base_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "base_fields_table" ON "base_fields" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "base_records_table" ON "base_records" USING btree ("table_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "base_records_source" ON "base_records" USING btree ("table_id","source_ref");--> statement-breakpoint
CREATE INDEX "base_tables_base" ON "base_tables" USING btree ("base_id");--> statement-breakpoint
CREATE INDEX "base_views_table" ON "base_views" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "record_comments_record" ON "record_comments" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "record_revisions_record" ON "record_revisions" USING btree ("record_id","at");--> statement-breakpoint
UPDATE memberships SET platform_role = CASE
  WHEN role = 'org_admin' THEN 'owner'
  WHEN role IN ('executive','producer') THEN 'creator'
  WHEN role IN ('cast','crew','external_reviewer') THEN 'commenter'
  ELSE 'editor' END;
