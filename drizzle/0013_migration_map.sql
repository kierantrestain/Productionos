CREATE TABLE IF NOT EXISTS "migration_map" (
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "source_system" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" text NOT NULL,
  "target_id" uuid NOT NULL,
  "meta" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "migration_map_pk" PRIMARY KEY ("org_id","source_system","source_kind","source_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "migration_map_target" ON "migration_map" ("target_id");
