ALTER TABLE "book_briefs" ADD COLUMN "style_sample_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "book_briefs" ADD COLUMN "preselected_element_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "book_briefs" ADD COLUMN "style_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "book_briefs" ADD CONSTRAINT "book_briefs_style_profile_id_style_profiles_id_fk" FOREIGN KEY ("style_profile_id") REFERENCES "public"."style_profiles"("id") ON DELETE set null ON UPDATE no action;