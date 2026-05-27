CREATE TABLE "volume_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"volume_idx" integer NOT NULL,
	"volume_name" text DEFAULT '' NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"summary_md" text NOT NULL,
	"pivots_md" text DEFAULT '' NOT NULL,
	"style_drift_notes_md" text DEFAULT '' NOT NULL,
	"arc_ids_covered" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"generated_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volume_summaries_book_idx_unique" UNIQUE("book_id","volume_idx")
);
--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "derived_from_chapters_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "volume_summaries" ADD CONSTRAINT "volume_summaries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;