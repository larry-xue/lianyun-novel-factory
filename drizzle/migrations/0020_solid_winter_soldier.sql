-- 0020: 题材契约 + POV 锁 + 章末 hook 写回
-- books.protagonist NOT NULL 没有兼容 default，旧 books 全部清空（含 53 章漂移病例书）
-- 用户授权"不兼容旧书籍，重新开书"
TRUNCATE TABLE "books" CASCADE;
--> statement-breakpoint
ALTER TABLE "book_states" ADD COLUMN "last_hook_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "protagonist" text NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "prohibited_tropes" text[] DEFAULT '{}'::text[] NOT NULL;
