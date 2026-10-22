CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "caption_segment" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"status" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker" text,
	"raw_text" text NOT NULL,
	"text" text NOT NULL,
	"parts" jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]' NOT NULL,
	"slide_pointer" jsonb,
	"confidence" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gaze_transition" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gaze_transition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" text NOT NULL,
	"from_zone" text NOT NULL,
	"to_zone" text NOT NULL,
	"target_id" text,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lecture_context" (
	"session_id" text PRIMARY KEY,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"text" text,
	"topics" jsonb DEFAULT '[]' NOT NULL,
	"glossary" jsonb DEFAULT '[]' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lecture_notes" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL UNIQUE,
	"content" jsonb NOT NULL,
	"generated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lecture_session" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"subject" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"context_status" text DEFAULT 'EMPTY' NOT NULL,
	"slides_status" text DEFAULT 'EMPTY' NOT NULL,
	"notes_status" text DEFAULT 'EMPTY' NOT NULL,
	"notes_error" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"ended_at" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_asset" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"content_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_job" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" bigint NOT NULL,
	"lease_until" bigint,
	"token" text,
	"error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_work" (
	"key" text PRIMARY KEY,
	"job_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sign_utterance" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"source" text NOT NULL,
	"gloss" jsonb NOT NULL,
	"text" text NOT NULL,
	"alternatives" jsonb DEFAULT '[]' NOT NULL,
	"audio_url" text,
	"confidence" real NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "slide_deck" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL UNIQUE,
	"file_name" text NOT NULL,
	"status" text NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"slides" jsonb DEFAULT '[]' NOT NULL,
	"error" text,
	"uploaded_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caption_segment_session_seq_idx" ON "caption_segment" ("session_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gaze_transition_session_idx" ON "gaze_transition" ("session_id","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lecture_session_user_idx" ON "lecture_session" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_asset_session_idx" ON "platform_asset" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_job_pending_idx" ON "platform_job" ("status","available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_job_session_idx" ON "platform_job" ("session_id");--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"account"'::regclass AND conname = 'account_user_id_user_id_fkey') THEN ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"session"'::regclass AND conname = 'session_user_id_user_id_fkey') THEN ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"caption_segment"'::regclass AND conname = 'caption_segment_session_id_lecture_session_id_fkey') THEN ALTER TABLE "caption_segment" ADD CONSTRAINT "caption_segment_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"gaze_transition"'::regclass AND conname = 'gaze_transition_session_id_lecture_session_id_fkey') THEN ALTER TABLE "gaze_transition" ADD CONSTRAINT "gaze_transition_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"lecture_context"'::regclass AND conname = 'lecture_context_session_id_lecture_session_id_fkey') THEN ALTER TABLE "lecture_context" ADD CONSTRAINT "lecture_context_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"lecture_notes"'::regclass AND conname = 'lecture_notes_session_id_lecture_session_id_fkey') THEN ALTER TABLE "lecture_notes" ADD CONSTRAINT "lecture_notes_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"lecture_session"'::regclass AND conname = 'lecture_session_user_id_user_id_fkey') THEN ALTER TABLE "lecture_session" ADD CONSTRAINT "lecture_session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"sign_utterance"'::regclass AND conname = 'sign_utterance_session_id_lecture_session_id_fkey') THEN ALTER TABLE "sign_utterance" ADD CONSTRAINT "sign_utterance_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"slide_deck"'::regclass AND conname = 'slide_deck_session_id_lecture_session_id_fkey') THEN ALTER TABLE "slide_deck" ADD CONSTRAINT "slide_deck_session_id_lecture_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "lecture_session"("id") ON DELETE CASCADE; END IF; END $$;
--> statement-breakpoint
ALTER TABLE "lecture_session" ADD COLUMN IF NOT EXISTS "notes_error" text;
