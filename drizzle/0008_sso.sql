CREATE TABLE IF NOT EXISTS "sso_configs" (
  "org_id" uuid PRIMARY KEY NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "issuer" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_cipher" text,
  "allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "default_role" text DEFAULT 'reader' NOT NULL,
  "is_enabled" boolean DEFAULT false NOT NULL,
  "enforce" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
