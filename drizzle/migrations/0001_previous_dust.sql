CREATE TYPE "public"."batch_job_status" AS ENUM('pending', 'running', 'success', 'killed', 'failure');--> statement-breakpoint
CREATE TYPE "public"."batch_status" AS ENUM('queued', 'running', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."world_rule_kind" AS ENUM('magic', 'power-level', 'geography', 'faction', 'timeline', 'taboo', 'currency', 'language', 'organization', 'lore', 'other');--> statement-breakpoint
CREATE TYPE "public"."world_rule_status" AS ENUM('canonical', 'soft', 'experimental', 'deprecated');--> statement-breakpoint
CREATE TABLE "batch_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"status" "batch_job_status" DEFAULT 'pending' NOT NULL,
	"topic_title" text NOT NULL,
	"pitch" text NOT NULL,
	"element_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"style_profile_id" uuid,
	"book_id" uuid,
	"root_run_id" uuid,
	"pg_boss_job_id" text,
	"error_md" text,
	"result_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "batch_status" DEFAULT 'queued' NOT NULL,
	"concurrency" integer DEFAULT 2 NOT NULL,
	"early_kill_below_chars" integer DEFAULT 2200 NOT NULL,
	"jobs_total" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"jobs_killed" integer DEFAULT 0 NOT NULL,
	"jobs_failed" integer DEFAULT 0 NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arc_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"arc_idx" integer NOT NULL,
	"arc_name" text DEFAULT '' NOT NULL,
	"range_start" integer NOT NULL,
	"range_end" integer NOT NULL,
	"summary_md" text NOT NULL,
	"pivots_md" text DEFAULT '' NOT NULL,
	"open_threads" text[] DEFAULT '{}'::text[] NOT NULL,
	"generated_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arc_summaries_book_idx_unique" UNIQUE("book_id","arc_idx")
);
--> statement-breakpoint
CREATE TABLE "outline_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"outline_md" text NOT NULL,
	"chapter_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_md" text DEFAULT '' NOT NULL,
	"triggered_at_chapter_idx" integer,
	"generated_by_run_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outline_revisions_book_version_unique" UNIQUE("book_id","version")
);
--> statement-breakpoint
CREATE TABLE "world_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "world_rule_kind" NOT NULL,
	"status" "world_rule_status" DEFAULT 'canonical' NOT NULL,
	"rule_md" text NOT NULL,
	"examples_md" text DEFAULT '' NOT NULL,
	"counterexamples_md" text DEFAULT '' NOT NULL,
	"introduced_at_chapter_idx" integer,
	"last_touched_at_chapter_idx" integer,
	"generated_by_run_id" uuid,
	"related_rule_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_rules_book_slug_unique" UNIQUE("book_id","slug")
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "outline_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "book_summary_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "batch_jobs" ADD CONSTRAINT "batch_jobs_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arc_summaries" ADD CONSTRAINT "arc_summaries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_revisions" ADD CONSTRAINT "outline_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_rules" ADD CONSTRAINT "world_rules_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;