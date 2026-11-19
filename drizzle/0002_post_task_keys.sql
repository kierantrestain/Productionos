ALTER TABLE "post_tasks" ADD COLUMN "generation_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "post_tasks_generation_key" ON "post_tasks" USING btree ("generation_key");