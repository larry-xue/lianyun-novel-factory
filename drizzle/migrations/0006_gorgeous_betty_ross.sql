CREATE TYPE "public"."doc_editor" AS ENUM('agent', 'human');--> statement-breakpoint
CREATE TABLE "book_doc_kinds" (
	"slug" text PRIMARY KEY NOT NULL,
	"zh" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"introduced_by" "doc_editor" DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_doc_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_md" text NOT NULL,
	"edited_by" "doc_editor" NOT NULL,
	"reason_md" text DEFAULT '' NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_edited_by" "doc_editor" DEFAULT 'agent' NOT NULL,
	"generated_by_run_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_docs_book_kind_slug_unique" UNIQUE("book_id","kind","slug")
);
--> statement-breakpoint
ALTER TABLE "book_doc_revisions" ADD CONSTRAINT "book_doc_revisions_doc_id_book_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."book_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_docs" ADD CONSTRAINT "book_docs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- Seed 6 个预置 kind。AI 后续可 upsert 新 kind。
-- ============================================================================
INSERT INTO "book_doc_kinds" (slug, zh, description_md, introduced_by) VALUES
  ('relations', '人物关系', '主角和配角之间的关系网，敌友/亲缘/势位连接。', 'human'),
  ('map', '地图', '世界地理：大陆/势力范围/重要地点。可多份（主大陆 / 副本世界）。', 'human'),
  ('timeline', '时间线', '大事记。按章节/年代列重要事件。', 'human'),
  ('lore', '设定', '杂项世界观设定，不属于硬规则的软描述。', 'human'),
  ('forbidden', '禁忌', '主编禁的题材/桥段/词汇，写手必须规避。', 'human'),
  ('reader_notes', '主编笔记', '主编自己的备忘，不喂给 agent。', 'human')
ON CONFLICT (slug) DO NOTHING;