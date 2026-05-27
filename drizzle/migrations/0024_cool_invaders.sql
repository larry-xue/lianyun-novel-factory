ALTER TABLE "books" ADD COLUMN "logline_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "audience" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "main_arc_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- ============================================================================
-- 清理 dead kinds：map 与 forbidden 从未被任何 agent 写入。
-- map 与 world-design 完全重叠；forbidden 已被 books.prohibited_tropes 替代。
-- ON DELETE CASCADE 会带走旧 book_docs（事实上数据库中不会有，但保险起见）。
-- ============================================================================
DELETE FROM "book_docs" WHERE "kind" IN ('map', 'forbidden');--> statement-breakpoint
DELETE FROM "book_doc_kinds" WHERE "slug" IN ('map', 'forbidden');