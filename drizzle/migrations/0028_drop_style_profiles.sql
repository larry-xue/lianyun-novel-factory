-- ============================================================================
-- 删风格指纹（style_profiles）：
-- - 立项时让用户钦点风格指纹 → 从 books.style_md 复制副本 → chapter-writer
--   prompt 注入 这条路径整条砍。
-- - 风格的 single source of truth 改为 book_docs(kind='style', slug=...)，
--   走 vault docs 自然注入路径。
-- - 范文库（style_samples 表）保留，仅作为立项 scout agent 的"参考素材"。
-- - 已存在的 style_profiles 数据 / books.style_md 内容直接丢弃，本仓没有
--   外部依赖
-- ============================================================================

ALTER TABLE "books" DROP CONSTRAINT IF EXISTS "books_style_profile_id_style_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "book_briefs" DROP CONSTRAINT IF EXISTS "book_briefs_style_profile_id_style_profiles_id_fk";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN IF EXISTS "style_profile_id";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN IF EXISTS "style_md";--> statement-breakpoint
ALTER TABLE "book_briefs" DROP COLUMN IF EXISTS "style_profile_id";--> statement-breakpoint
ALTER TABLE "batch_jobs" DROP COLUMN IF EXISTS "style_profile_id";--> statement-breakpoint
DROP TABLE IF EXISTS "style_profiles" CASCADE;--> statement-breakpoint

-- 删 prompts 表里的 style-* 系统提示（agent 文件本身在代码层删；这里清残留）
DELETE FROM "prompts" WHERE "slug" IN (
  'style-distiller.system',
  'style-tweaker.system',
  'style-polisher.system'
);
