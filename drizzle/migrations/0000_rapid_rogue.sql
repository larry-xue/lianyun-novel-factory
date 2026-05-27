CREATE TYPE "public"."topic_status" AS ENUM('draft', 'approved', 'launched', 'shelved');--> statement-breakpoint
CREATE TYPE "public"."book_status" AS ENUM('planning', 'writing', 'paused', 'completed', 'killed');--> statement-breakpoint
CREATE TYPE "public"."chapter_status" AS ENUM('planned', 'drafting', 'hooking', 'polishing', 'guarding', 'final', 'killed');--> statement-breakpoint
CREATE TYPE "public"."revision_kind" AS ENUM('raw', 'hooked', 'polished', 'guard_fixed', 'manual');--> statement-breakpoint
CREATE TYPE "public"."hook_kind" AS ENUM('open', 'close', 'cliff', 'reveal');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'success', 'failure', 'cancelled');--> statement-breakpoint
CREATE TABLE "elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"zh" text NOT NULL,
	"category" text NOT NULL,
	"hot_score" real DEFAULT 0 NOT NULL,
	"definition_md" text DEFAULT '' NOT NULL,
	"combo_friendly" text[] DEFAULT '{}'::text[] NOT NULL,
	"combo_avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"profile_md" text DEFAULT '' NOT NULL,
	"parent_id" uuid,
	"distilled_from" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"tweak_instructions" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_profiles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "style_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author" text NOT NULL,
	"title" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"content_md" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"element_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_audience" text DEFAULT '' NOT NULL,
	"status" "topic_status" DEFAULT 'draft' NOT NULL,
	"score" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score_overall" real DEFAULT 0 NOT NULL,
	"notes_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_states" (
	"book_id" uuid NOT NULL,
	"chapter_idx" integer NOT NULL,
	"arc_stage" text DEFAULT '' NOT NULL,
	"active_characters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"open_threads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_event_summary_md" text DEFAULT '' NOT NULL,
	"next_chapter_intent_md" text DEFAULT '' NOT NULL,
	"generated_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_states_book_id_chapter_idx_pk" PRIMARY KEY("book_id","chapter_idx")
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "book_status" DEFAULT 'planning' NOT NULL,
	"topic_card_id" uuid,
	"style_profile_id" uuid,
	"element_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"outline_md" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"card_md" text DEFAULT '' NOT NULL,
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"kind" "revision_kind" NOT NULL,
	"content_md" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"notes_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" "chapter_status" DEFAULT 'planned' NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_book_idx_unique" UNIQUE("book_id","idx")
);
--> statement-breakpoint
CREATE TABLE "hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "hook_kind" NOT NULL,
	"template_md" text NOT NULL,
	"scenarios" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anti_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"content_md" text NOT NULL,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"model" text NOT NULL,
	"prompt" jsonb NOT NULL,
	"response" text,
	"response_json" jsonb,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"error_md" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"parent_id" uuid,
	"book_id" uuid,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_md" text,
	"model" text,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_parent_id_style_profiles_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."style_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_states" ADD CONSTRAINT "book_states_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_topic_card_id_topic_cards_id_fk" FOREIGN KEY ("topic_card_id") REFERENCES "public"."topic_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_style_profile_id_style_profiles_id_fk" FOREIGN KEY ("style_profile_id") REFERENCES "public"."style_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_id_runs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;