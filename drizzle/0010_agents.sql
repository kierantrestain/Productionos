ALTER TABLE "base_automations" ADD COLUMN IF NOT EXISTS "webhook_token" text;
--> statement-breakpoint
ALTER TABLE "base_automations" ADD COLUMN IF NOT EXISTS "last_scheduled_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "base_automations_webhook_token_unique" ON "base_automations" ("webhook_token");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "base_agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "archived_at" timestamp with time zone,
  "base_id" uuid NOT NULL REFERENCES "bases"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "emoji" text DEFAULT '🤖' NOT NULL,
  "color" text DEFAULT 'blue' NOT NULL,
  "role" text,
  "instructions" text DEFAULT '' NOT NULL,
  "table_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "can_propose" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "base_agents"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL,
  "title" text DEFAULT 'New conversation' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_threads_agent_user" ON "agent_threads" ("agent_id","user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "agent_threads"("id") ON DELETE cascade,
  "role" text NOT NULL,
  "content" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_messages_thread" ON "agent_messages" ("thread_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "base_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id") ON DELETE cascade,
  "source" text NOT NULL,
  "source_id" uuid,
  "thread_id" uuid,
  "requested_by" uuid,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "summary" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "result" jsonb,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_approvals_base_status" ON "base_approvals" ("base_id","status");
