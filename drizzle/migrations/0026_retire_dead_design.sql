-- ============================================================================
-- 退役 schema-driven story-designer 残留：
-- - prompts 表里旧 slug 'story-designer.system' 不再被加载（agent 已删）
-- - book_doc_kinds 里的 'design' 是早期 agent 自动 introduce 的；新流程
--   (story-designer-harness) 不再写 kind='design'，从 picker 移除
--
-- 旧数据：book_docs 里仍可能有 kind='design' 的 4 份立项文档（旧版本书产
-- 出的）。保留不删，loadBookContext 仍把它们纳入 vault（chapter-writer
-- 静态区会读到）；只是不再自动注册 'design' 这个 kind 给 UI 选择。
-- ============================================================================
DELETE FROM "prompts" WHERE "slug" = 'story-designer.system';--> statement-breakpoint
DELETE FROM "book_doc_kinds" WHERE "slug" = 'design' AND "introduced_by" = 'agent';
