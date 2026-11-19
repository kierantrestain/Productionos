CREATE TABLE "file_blobs" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
