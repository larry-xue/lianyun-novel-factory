import { sql } from 'drizzle-orm';
import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_shared.ts';
import { books } from './books.ts';
import { topicCards } from './topics.ts';
import { styleSamples } from './styles.ts';

/**
 * 立项参数（盘子）：每本书 1:1。
 * 用户在 chat 立项时确定的硬指标，后续 produceBook 的入参。
 *
 * 用户在 /books/ 入口可预选 范文(多选) / 元素(多选)：两字段在 chat 开始前就已
 * 就位；brainstorm-harness 把它们当作 scout agent 的额外上下文注入 user prompt
 * （不污染对话历史）。**风格** 改为完全靠 book_docs(kind='style', ...) 维护，立项
 * 不再让用户钦点指纹。
 */
export const bookBriefs = pgTable('book_briefs', {
  bookId: uuid('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  briefIdeaMd: text('brief_idea_md').notNull().default(''),
  targetTotalChapters: integer('target_total_chapters').notNull().default(20),
  targetCharsPerChapter: integer('target_chars_per_chapter').notNull().default(3000),
  targetVolumeCount: integer('target_volume_count').notNull().default(1),
  targetArcsPerVolume: integer('target_arcs_per_volume').notNull().default(4),
  pacingProfileMd: text('pacing_profile_md').notNull().default(''),
  forbiddenMd: text('forbidden_md').notNull().default(''),
  /** 用户预选的范文（style_samples）id 列表；scout agent 看 contentMd 摘抄 */
  styleSampleIds: uuid('style_sample_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  /** 用户预选的元素 slug 列表；同时也 mirror 到 negotiations.decisions.elementSlugs */
  preselectedElementSlugs: text('preselected_element_slugs')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  ...timestamps,
});

// styleSamples 仅作类型引用（FK 是 uuid[] 不在这层做约束；删 sample 不会误删 brief）
void styleSamples;

export type BookBrief = typeof bookBriefs.$inferSelect;
export type BookBriefInsert = typeof bookBriefs.$inferInsert;

export const negotiationStatusEnum = pgEnum('negotiation_status', [
  'active',
  'designing',
  'confirmed',
  'abandoned',
]);

/**
 * 立项聊天历史。一本书一条 active negotiation。
 * messages 是 jsonb 数组，每条带 role/contentMd/candidates 或 widget。
 */
export interface NegotiationCandidate {
  kind: 'topic' | 'element-set' | 'logline' | 'character-pool' | 'pacing-profile' | 'other';
  title: string;
  bodyMd: string;
  /** 候选自带的结构化数据（如 topic 候选含 elementSlugs/scoreOverall） */
  data?: Record<string, unknown>;
  pickedByUser?: boolean;
}

/**
 * Generative-UI widget。brainstorm-harness 通过 ask_user 工具输出 widget，
 * 前端 WidgetRenderer 据此渲染对应组件。词汇对齐 Claude Code AskUserQuestion。
 */
export type NegotiationWidget =
  | {
      kind: 'multi-choice';
      header: string;
      question: string;
      options: Array<{ label: string; description: string }>;
    }
  | {
      kind: 'multi-pick';
      header: string;
      question: string;
      options: Array<{ label: string; description: string }>;
    }
  | {
      kind: 'free-text';
      header: string;
      question: string;
      placeholder?: string;
    }
  | {
      kind: 'confirm';
      header: string;
      summaryMd: string;
      /** 批准按钮的文案；默认 '批准开书'。design-review 的 start_writing 用 '开始写作' */
      approveLabel?: string;
    };

/**
 * agent 这一轮里调过的非终止工具（list_kb / read_kb / grep_kb / pin_decision /
 * unpin_decision），按 seq 排好。前端把它折叠成"5 个动作"卡片展示。
 */
export interface NegotiationAction {
  seq: number;
  tool: string;
  /** 摘要参数，给前端 1-2 行展示用 */
  argsSummary: string;
  /** 调用结果摘要，截断到 ~280 字 */
  resultMd: string;
  errorMd?: string;
  durationMs?: number;
}

export interface NegotiationMessage {
  role: 'user' | 'agent' | 'system';
  contentMd: string;
  /** 旧版候选卡片（兼容老数据，新对话不再产生） */
  candidates?: NegotiationCandidate[];
  /** brainstorm-harness 给的 widget；存在时前端用 WidgetRenderer 渲染 */
  widget?: NegotiationWidget;
  /**
   * 仅当 widget.kind='confirm' 时存在：agent 同 turn 通过 confirm_topic
   * 工具拟出的整本 brief。用户在 widget 上点"批准开书"时直接拿这份 brief
   * 落 topic_card + book_brief，无需重跑 agent。
   */
  briefDraft?: Record<string, unknown>;
  /**
   * 仅当 design-review-harness start_writing 终止 + widget=confirm 时存在：
   * agent 给的 produceForExistingBook 入参（gateMode）。用户点"开始写作"时
   * 直接读这份触发 startWriting，无需重跑 agent。
   */
  produceArgs?: {
    gateMode: 'fully-auto' | 'auto-with-confirm' | 'manual';
  };
  /** 这一轮 agent 调过的中间工具，给前端做"行动卡"展开 */
  actions?: NegotiationAction[];
  /** ISO 时间戳 */
  ts: string;
  /** agent 消息：关联到 runs 表 */
  runId?: string;
}

export const topicNegotiations = pgTable('topic_negotiations', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  topicCardId: uuid('topic_card_id').references(() => topicCards.id, { onDelete: 'set null' }),
  status: negotiationStatusEnum('status').notNull().default('active'),
  messages: jsonb('messages').$type<NegotiationMessage[]>().notNull().default([]),
  /**
   * brainstorm 累积的决策。key 例：mainCategory / elementSlugs /
   * targetAudience / coreConflict / charsPerChapter ... pin_decision 写
   * 入，unpin_decision 删。confirm_topic 时把这里的字段落到 topic_card +
   * book_brief。
   */
  decisions: jsonb('decisions').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export type TopicNegotiation = typeof topicNegotiations.$inferSelect;
export type TopicNegotiationInsert = typeof topicNegotiations.$inferInsert;
