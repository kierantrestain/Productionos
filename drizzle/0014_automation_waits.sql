CREATE TABLE IF NOT EXISTS "automation_waits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "automation_id" uuid NOT NULL REFERENCES "base_automations"("id") ON DELETE CASCADE,
  "table_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "steps" jsonb NOT NULL,
  "depth" integer DEFAULT 0 NOT NULL,
  "run_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "error" text
);
CREATE INDEX IF NOT EXISTS "automation_waits_due" ON "automation_waits" ("status","run_at");
