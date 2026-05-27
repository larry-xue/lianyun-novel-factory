import { integer, jsonb, pgEnum, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';
import type { NegotiationAction, NegotiationWidget } from './negotiations.ts';

/**
 * 单章「chapter-scout」chat：用户与 agent 对一章 beat 协商。
 * 复用 negotiations 的 widget / action 形状，让前端 WidgetRenderer 直接渲染。
 *
 * (book_id, chapter_idx) 复合 PK：每章一条会话；status='confirmed' 时 agent 已写过
 * 一份 book_docs(kind='chapter-plan', slug='ch{idx}-plan', pinned_by_user=true)。
 */

export const chapterScoutStatusEnum = pgEnum('chapter_scout_status', [
  'active',
  'confirmed',
  'abandoned',
]);

export interface ChapterScoutMessage {
  role: 'user' | 'agent' | 'system';
  contentMd: string;
  /** 仿 brainstorm-harness：ask_user 软终止时附 widget */
  widget?: NegotiationWidget;
  /**
   * confirm widget 时附本轮 agent 拟定的 beat 草案（confirm 后落
   * book_docs.kind='chapter-plan'）。
   */
  beatDraft?: Record<string, unknown>;
  actions?: NegotiationAction[];
  ts: string;
  runId?: string;
}

export const chapterScoutSessions = pgTable(
  'chapter_scout_sessions',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapterIdx: integer('chapter_idx').notNull(),
    status: chapterScoutStatusEnum('status').notNull().default('active'),
    messages: jsonb('messages').$type<ChapterScoutMessage[]>().notNull().default([]),
    /**
     * scout 累积的 beat 字段（title / summaryMd / intent / twist / anchors 等）。
     * confirm 时落 book_docs.meta.beat。
     */
    decisions: jsonb('decisions').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.bookId, t.chapterIdx] })],
);

export type ChapterScoutSession = typeof chapterScoutSessions.$inferSelect;
export type ChapterScoutSessionInsert = typeof chapterScoutSessions.$inferInsert;
