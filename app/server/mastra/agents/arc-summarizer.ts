import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { sharedModel } from '../model.ts';

export const ArcSummaryResultSchema = z.object({
  arcName: z.string().min(2).max(40),
  summaryMd: z.string().min(80),
  pivotsMd: z.string().min(20),
  openThreads: z.array(z.string().min(2)).default([]),
});
export type ArcSummaryResult = z.infer<typeof ArcSummaryResultSchema>;

export const BookSummaryResultSchema = z.object({
  summaryMd: z.string().min(120),
});
export type BookSummaryResult = z.infer<typeof BookSummaryResultSchema>;

const ARC_SYSTEM = `你是「Arc 摘要师」(arc-summarizer)。
任务：把连续 K 章正文压成一段 arc 级摘要，便于后续章节写作不必重读全文。

输出：
- arcName: 这一段剧情段的名字（如"末世第一周"、"宗门内斗"）
- summaryMd: 200-450 字，按时间序梳理本 arc 的关键事件、人物变化、主线推进。不要逐章罗列，要合并因果。
- pivotsMd: 80-200 字，列出这段里**对后续走向影响最大的 2-4 个转折点**。
- openThreads: 这段结束时仍未回收的悬念（数组，每条一句话）。

严格 JSON 输出，不要 markdown code fence。`;

export const arcSummarizer = new Agent({
  id: 'arc-summarizer',
  name: 'Arc 摘要师',
  instructions: ARC_SYSTEM,
  model: sharedModel,
});

export const ARC_SUMMARIZER_PROMPT = ARC_SYSTEM;

const BOOK_SYSTEM = `你是「整本摘要师」(book-summarizer)。
任务：把全书已写部分（多个 arc 摘要）压成一段长摘要，便于：
1) 给读者展示故事概览
2) 给 chapter-writer 在写作时随时回看"我这本书到底在讲什么"

输出 summaryMd: 300-600 字，必须按"开端 - 发展 - 当前状态 - 暗线"四段叙述。
严格 JSON 输出。`;

export const bookSummarizer = new Agent({
  id: 'book-summarizer',
  name: '整本摘要师',
  instructions: BOOK_SYSTEM,
  model: sharedModel,
});

export const BOOK_SUMMARIZER_PROMPT = BOOK_SYSTEM;
