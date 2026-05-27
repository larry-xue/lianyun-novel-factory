CREATE TYPE "public"."chapter_scout_status" AS ENUM('active', 'confirmed', 'abandoned');--> statement-breakpoint
CREATE TABLE "chapter_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_idx" integer NOT NULL,
	"kind" text DEFAULT 'pilot' NOT NULL,
	"batch_id" uuid,
	"state_jsonb" jsonb DEFAULT '{"arcStage":"","activeCharacters":[],"lastEventSummaryMd":"","nextChapterIntentMd":""}'::jsonb NOT NULL,
	"docs_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_snapshots_book_idx_unique" UNIQUE("book_id","chapter_idx")
);
--> statement-breakpoint
CREATE TABLE "chapter_scout_sessions" (
	"book_id" uuid NOT NULL,
	"chapter_idx" integer NOT NULL,
	"status" "chapter_scout_status" DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_scout_sessions_book_id_chapter_idx_pk" PRIMARY KEY("book_id","chapter_idx")
);
--> statement-breakpoint
ALTER TABLE "book_docs" ADD COLUMN "pinned_by_user" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_snapshots" ADD CONSTRAINT "chapter_snapshots_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_snapshots" ADD CONSTRAINT "chapter_snapshots_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_scout_sessions" ADD CONSTRAINT "chapter_scout_sessions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;