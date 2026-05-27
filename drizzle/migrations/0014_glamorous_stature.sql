CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"parent_llm_call_id" uuid,
	"seq" integer NOT NULL,
	"tool_name" text NOT NULL,
	"args_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_md" text DEFAULT '' NOT NULL,
	"error_md" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_parent_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("parent_llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;