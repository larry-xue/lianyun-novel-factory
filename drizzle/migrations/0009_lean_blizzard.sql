CREATE TYPE "public"."prompt_role" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TABLE "prompt_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"template_md" text NOT NULL,
	"edited_by" "doc_editor" NOT NULL,
	"reason_md" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_revisions_slug_version_unique" UNIQUE("slug","version")
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"slug" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"role" "prompt_role" NOT NULL,
	"title" text NOT NULL,
	"template_md" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes_md" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
