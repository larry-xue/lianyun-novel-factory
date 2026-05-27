ALTER TABLE "topic_cards" ADD COLUMN "main_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_cards" ADD COLUMN "themes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_cards" ADD COLUMN "character_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_cards" ADD COLUMN "plot_elements" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "main_category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "themes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "character_types" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "plot_elements" text[] DEFAULT '{}'::text[] NOT NULL;