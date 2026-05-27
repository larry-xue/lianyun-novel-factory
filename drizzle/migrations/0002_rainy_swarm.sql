CREATE TYPE "public"."thread_event_kind" AS ENUM('introduce', 'hint', 'pay', 'abandon');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'hinted', 'paying', 'paid_off', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."thread_weight" AS ENUM('small', 'arc', 'book');--> statement-breakpoint
CREATE TABLE "plot_thread_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_idx" integer NOT NULL,
	"kind" "thread_event_kind" NOT NULL,
	"note_md" text DEFAULT '' NOT NULL,
	"generated_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"weight" "thread_weight" DEFAULT 'arc' NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"introduced_at_chapter_idx" integer NOT NULL,
	"expected_payoff_start" integer NOT NULL,
	"expected_payoff_end" integer NOT NULL,
	"payoff_trigger_md" text DEFAULT '' NOT NULL,
	"related_character_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"related_rule_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"detail_md" text DEFAULT '' NOT NULL,
	"payoff_notes_md" text DEFAULT '' NOT NULL,
	"generated_by_run_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plot_threads_book_slug_unique" UNIQUE("book_id","slug")
);
--> statement-breakpoint
ALTER TABLE "plot_thread_events" ADD CONSTRAINT "plot_thread_events_thread_id_plot_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."plot_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_thread_events" ADD CONSTRAINT "plot_thread_events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ============================================================================
-- Data migration: backfill plot_threads from book_states.open_threads (v1)
-- 每本书每条字符串伏笔升格成一行，weight=arc / status=open / 窗口默认 [+1, +10]。
-- 同时给每条插一个 introduce 事件（最早出现的 chapter_idx）。
-- 幂等：靠 unique(book_id, slug) + ON CONFLICT DO NOTHING。
-- ============================================================================
WITH expanded AS (
  SELECT bs.book_id, bs.chapter_idx, elem AS thread_text
  FROM book_states bs,
       LATERAL jsonb_array_elements_text(bs.open_threads) AS elem
  WHERE jsonb_typeof(bs.open_threads) = 'array'
    AND jsonb_array_length(bs.open_threads) > 0
),
first_appearance AS (
  SELECT book_id, thread_text, MIN(chapter_idx) AS introduced_at
  FROM expanded
  GROUP BY book_id, thread_text
),
inserted AS (
  INSERT INTO plot_threads (
    book_id, slug, title, weight, status,
    introduced_at_chapter_idx, expected_payoff_start, expected_payoff_end,
    payoff_trigger_md, detail_md, meta
  )
  SELECT
    book_id,
    'legacy-' || substr(md5(thread_text), 1, 16),
    LEFT(thread_text, 200),
    'arc'::thread_weight,
    'open'::thread_status,
    GREATEST(introduced_at, 0),
    GREATEST(introduced_at, 0) + 1,
    GREATEST(introduced_at, 0) + 10,
    '（迁移自 v1 字符串伏笔，无明确触发条件）',
    thread_text,
    jsonb_build_object('migrated_from', 'book_states.open_threads')
  FROM first_appearance
  ON CONFLICT (book_id, slug) DO NOTHING
  RETURNING id, book_id, introduced_at_chapter_idx
)
INSERT INTO plot_thread_events (thread_id, book_id, chapter_idx, kind, note_md)
SELECT id, book_id, introduced_at_chapter_idx, 'introduce', '迁移：标记原始引入'
FROM inserted;