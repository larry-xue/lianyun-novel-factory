CREATE TYPE "public"."gate_kind" AS ENUM('gate-1', 'gate-2', 'gate-3');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "gate_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"kind" "gate_kind" NOT NULL,
	"status" "gate_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note_md" text DEFAULT '' NOT NULL,
	"triggered_by_run_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_note_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gate_requests" ADD CONSTRAINT "gate_requests_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;