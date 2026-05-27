CREATE TYPE "public"."negotiation_status" AS ENUM('active', 'confirmed', 'abandoned');--> statement-breakpoint
CREATE TABLE "book_briefs" (
	"book_id" uuid PRIMARY KEY NOT NULL,
	"brief_idea_md" text DEFAULT '' NOT NULL,
	"target_total_chapters" integer DEFAULT 20 NOT NULL,
	"target_chars_per_chapter" integer DEFAULT 3000 NOT NULL,
	"target_volume_count" integer DEFAULT 1 NOT NULL,
	"target_arcs_per_volume" integer DEFAULT 4 NOT NULL,
	"pacing_profile_md" text DEFAULT '' NOT NULL,
	"forbidden_md" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"topic_card_id" uuid,
	"status" "negotiation_status" DEFAULT 'active' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_briefs" ADD CONSTRAINT "book_briefs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_negotiations" ADD CONSTRAINT "topic_negotiations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_negotiations" ADD CONSTRAINT "topic_negotiations_topic_card_id_topic_cards_id_fk" FOREIGN KEY ("topic_card_id") REFERENCES "public"."topic_cards"("id") ON DELETE set null ON UPDATE no action;