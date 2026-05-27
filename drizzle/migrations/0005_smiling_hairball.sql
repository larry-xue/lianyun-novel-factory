CREATE TYPE "public"."gate_mode" AS ENUM('fully-auto', 'auto-with-confirm', 'manual');--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "gate_mode" "gate_mode" DEFAULT 'fully-auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_states" DROP COLUMN "open_threads";