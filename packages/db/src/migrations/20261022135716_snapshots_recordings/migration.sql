CREATE TABLE IF NOT EXISTS "recording" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ended_at" bigint,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"segments" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"image_url" text NOT NULL,
	"trigger" text NOT NULL,
	"reason" text NOT NULL,
	"captured_at" bigint NOT NULL,
	"at_ms" integer NOT NULL,
	"segment_ids" jsonb DEFAULT '[]' NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recording_session_idx" ON "recording" ("session_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_session_idx" ON "snapshot" ("session_id","captured_at");--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"recording"'::regclass AND conname = 'recording_session_id_lecture_session_id_fkey') THEN ALTER TABLE "recording" ADD CONSTRAINT "recording_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"snapshot"'::regclass AND conname = 'snapshot_session_id_lecture_session_id_fkey') THEN ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;
