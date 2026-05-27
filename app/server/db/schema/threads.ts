import { sql } from 'drizzle-orm';
import { integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';

/**
 * 伏笔权重：决定回收紧迫度。
 * - small: 小段闲笔（铺氛围/抖机灵），3-5 章内回收
 * - arc:   弧级伏笔（影响一段剧情），一卷内回收
 * - book:  全书级伏笔（贯穿主线），最终高潮回收
 */
export const threadWeightEnum = pgEnum('thread_weight', ['small', 'arc', 'book']);

/**
 * 伏笔状态。abandoned = 超期作废，不强行圆。
 */
export const threadStatusEnum = pgEnum('thread_status', [
  'open',
  'hinted',
  'paying',
  'paid_off',
  'abandoned',
]);

/**
 * 伏笔事件类型：章节与伏笔的关联动作。
 */
export const threadEventKindEnum = pgEnum('thread_event_kind', [
  'introduce',
  'hint',
  'pay',
  'abandon',
]);

/**
 * 结构化伏笔追踪表。替代 v1 的 `bookStates.openThreads: jsonb<string[]>`。
 *
 * 关键设计：
 * - expectedPayoffStart/End 是窗口而非具体值（容许漂移）
 * - payoffTriggerMd 用自然语言描述回收条件（"主角第一次离开新手村后"）
 * - relatedCharacterIds/RuleSlugs 是软关联，agent 用作上下文，DB 不强制外键
 *   （因为可能引到尚未建表的 character/rule，强外键会让插入失败）
 */
export const plotThreads = pgTable(
  'plot_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    weight: threadWeightEnum('weight').notNull().default('arc'),
    status: threadStatusEnum('status').notNull().default('open'),
    introducedAtChapterIdx: integer('introduced_at_chapter_idx').notNull(),
    expectedPayoffStart: integer('expected_payoff_start').notNull(),
    expectedPayoffEnd: integer('expected_payoff_end').notNull(),
    payoffTriggerMd: text('payoff_trigger_md').notNull().default(''),
    relatedCharacterIds: uuid('related_character_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    relatedRuleSlugs: text('related_rule_slugs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    detailMd: text('detail_md').notNull().default(''),
    payoffNotesMd: text('payoff_notes_md').notNull().default(''),
    generatedByRunId: uuid('generated_by_run_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [unique('plot_threads_book_slug_unique').on(t.bookId, t.slug)],
);

export type PlotThread = typeof plotThreads.$inferSelect;
export type PlotThreadInsert = typeof plotThreads.$inferInsert;

/**
 * 伏笔事件：每章对每个伏笔做了什么动作（引入/暗示/回收/作废）。
 * 既是审计流，也是统计来源（"第 N 章触发了多少坑"）。
 *
 * bookId 冗余存一份方便按书查询，避免每次都 join plot_threads。
 */
export const plotThreadEvents = pgTable('plot_thread_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => plotThreads.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  chapterIdx: integer('chapter_idx').notNull(),
  kind: threadEventKindEnum('kind').notNull(),
  noteMd: text('note_md').notNull().default(''),
  generatedByRunId: uuid('generated_by_run_id'),
  ...timestamps,
});

export type PlotThreadEvent = typeof plotThreadEvents.$inferSelect;
export type PlotThreadEventInsert = typeof plotThreadEvents.$inferInsert;
