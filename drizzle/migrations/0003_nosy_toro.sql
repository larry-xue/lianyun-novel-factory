CREATE TYPE "public"."outline_node_level" AS ENUM('volume', 'arc', 'chapter');--> statement-breakpoint
CREATE TYPE "public"."outline_node_status" AS ENUM('planned', 'writing', 'done', 'revised', 'skipped');--> statement-breakpoint
CREATE TABLE "outline_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" "outline_node_level" NOT NULL,
	"idx" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary_md" text DEFAULT '' NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"pacing_phase" text DEFAULT '' NOT NULL,
	"status" "outline_node_status" DEFAULT 'planned' NOT NULL,
	"chapter_id" uuid,
	"expected_thread_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_by_run_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_parent_id_outline_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."outline_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outline_nodes" ADD CONSTRAINT "outline_nodes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- 两条 partial unique index 模拟 nullsNotDistinct（drizzle 0.39 不支持原生）
-- ============================================================================
CREATE UNIQUE INDEX "outline_nodes_book_parent_idx_unique"
  ON "outline_nodes" ("book_id", "parent_id", "idx")
  WHERE "parent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outline_nodes_book_root_idx_unique"
  ON "outline_nodes" ("book_id", "idx")
  WHERE "parent_id" IS NULL;--> statement-breakpoint
-- ============================================================================
-- Data migration: backfill outline_nodes from outline_revisions[latest].chapter_plan
-- 老数据没有卷/弧层级信息，全部当作顶层 chapter 节点（parent_id=null）。
-- 只回填每本书 outline_revisions 的最高 version 那一份。
-- 幂等：先清空目标书的旧 chapter 节点，再插。本次首迁移目标表本就空，安全。
-- ============================================================================
WITH latest_revisions AS (
  SELECT DISTINCT ON (book_id) book_id, id, chapter_plan, generated_by_run_id
  FROM outline_revisions
  ORDER BY book_id, version DESC
),
expanded AS (
  SELECT
    lr.book_id,
    lr.generated_by_run_id,
    (elem ->> 'idx')::int AS idx,
    COALESCE(elem ->> 'title', '') AS title,
    COALESCE(elem ->> 'summaryMd', '') AS summary_md,
    COALESCE(elem ->> 'intent', '') AS intent
  FROM latest_revisions lr,
       LATERAL jsonb_array_elements(lr.chapter_plan) AS elem
  WHERE jsonb_typeof(lr.chapter_plan) = 'array'
)
INSERT INTO outline_nodes (
  book_id, parent_id, level, idx, title, summary_md, intent, status, generated_by_run_id, meta
)
SELECT
  book_id,
  NULL,
  'chapter'::outline_node_level,
  idx,
  title,
  summary_md,
  intent,
  'planned'::outline_node_status,
  generated_by_run_id,
  jsonb_build_object('migrated_from', 'outline_revisions.chapter_plan')
FROM expanded
ON CONFLICT DO NOTHING;