CREATE TABLE IF NOT EXISTS "user_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "account_label" text,
  "access_token_enc" text NOT NULL,
  "refresh_token_enc" text,
  "expires_at" timestamp with time zone,
  "scopes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_connections_one" ON "user_connections" ("org_id","user_id","provider");
ALTER TABLE "base_agents" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'claude' NOT NULL;
