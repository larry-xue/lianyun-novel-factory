import { sql } from 'drizzle-orm';
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { topicCards } from './topics.ts';
import { users } from './users.ts';
import type { BookClassification } from './classification.ts';

export const bookStatusEnum = pgEnum('book_status', [
  'planning',
  'writing',
  'paused',
  'completed',
  'killed',
]);

/**
 * gate 行为模式：
 * - fully-auto: 三道 gate 全自动通过（smoke / 批量铺量场景）
 * - auto-with-confirm: 立项 + 卷规划 暂停等人确认；单章 auto pass（默认正式书）
 * - manual: 三道 gate 全暂停等确认（重要书 / 全程主编介入）
 */
export const gateModeEnum = pgEnum('gate_mode', [
  'fully-auto',
  'auto-with-confirm',
  'manual',
]);

/**
 * 一本书 = 一个工作区。
 * outline_md 是大纲（章节摘要列表），meta 放 word-count target、章数等。
 */
export const books = pgTable('books', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  status: bookStatusEnum('status').notNull().default('planning'),
  /** 创建者；NULL = 系统/历史遗留，仅 admin 可改/删 */
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
  topicCardId: uuid('topic_card_id').references(() => topicCards.id, { onDelete: 'set null' }),
  elementSlugs: text('element_slugs')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** 主角名。POV 锁的依据：chapter-planner 输出的 milestone.povCharacter 必须等于此值。
   * DB 层默认 '' 是为兼容测试 stub；正式 book 创建流（book-producer / topic-scout）必须显式给非空值。 */
  protagonist: text('protagonist').notNull().default(''),
  /** 一句话概括（30-80 字）。story-designer harness 的 submit_design 必填，落到这；
   * chapter-planner / chapter-writer prompt 静态区直接读，不再绕道 design/* 文档。 */
  loglineMd: text('logline_md').notNull().default(''),
  /** 目标读者一句话。同上由 submit_design 落，prompt 静态区直接读。 */
  audience: text('audience').notNull().default(''),
  /** 全书主线走向 200-400 字。同上。 */
  mainArcMd: text('main_arc_md').notNull().default(''),
  mainCategory: text('main_category').notNull().default(''),
  themes: text('themes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  characterTypes: text('character_types')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  plotElements: text('plot_elements')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** 题材红线：本书禁止引入的套路名清单（与 mainCategory + themes 配合用）。
   * 由 story-designer 立项时产出；chapter-planner / chapter-writer prompt 顶部统一贴出，
   * quality-linter 在 genre-trope-violation 维度做事后审计。 */
  prohibitedTropes: text('prohibited_tropes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  outlineMd: text('outline_md').notNull().default(''),
  outlineVersion: integer('outline_version').notNull().default(1),
  bookSummaryMd: text('book_summary_md').notNull().default(''),
  gateMode: gateModeEnum('gate_mode').notNull().default('fully-auto'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  ...timestamps,
});

export type Book = typeof books.$inferSelect;
export type BookInsert = typeof books.$inferInsert;

/**
 * 角色索引行：name / role 唯一对应一个角色 id。
 *
 * 阶段 2 后人设内容不再放这（card_md / traits 列已 drop），完整角色档案
 * 写在 book_docs(kind='character', slug=<拼音>) 里。这张表只是 (book_id,
 * name) → uuid 的索引，给 active_characters 引用 / 给 UI 列表用。
 */
export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  ...timestamps,
});

export type Character = typeof characters.$inferSelect;
export type CharacterInsert = typeof characters.$inferInsert;

/**
 * 书内工作记忆：每写完一章 dump 一份当前状态。
 * 下一章 chapter-writer 读最新一行作为上下文压缩。
 */
export const bookStates = pgTable(
  'book_states',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapterIdx: integer('chapter_idx').notNull(),
    arcStage: text('arc_stage').notNull().default(''),
    activeCharacters: jsonb('active_characters')
      .$type<Array<{ name: string; status: string }>>()
      .notNull()
      .default([]),
    lastEventSummaryMd: text('last_event_summary_md').notNull().default(''),
    /** 章末 hook 原文（≤250 字）。chapter-writer 提交本章时由生产环路写入，
     * 下一章的 chapter-writer prompt 顶部贴回，强制接续上一章末尾的人物/事件/异象，
     * 防止跨章 cliffhanger 在下章开头凭空消失。 */
    lastHookMd: text('last_hook_md').notNull().default(''),
    nextChapterIntentMd: text('next_chapter_intent_md').notNull().default(''),
    generatedByRunId: uuid('generated_by_run_id'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.chapterIdx] })],
);

export type BookState = typeof bookStates.$inferSelect;
export type BookStateInsert = typeof bookStates.$inferInsert;
