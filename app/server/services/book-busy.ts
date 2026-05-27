import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { batchJobs, gateRequests, runs } from '../db/schema/index.ts';

export type GateKind = 'gate-1' | 'gate-2' | 'gate-3';

/**
 * 用户主动触发的写作类 root run kinds（互斥：同一本书一次只能跑一个）
 */
export const WRITING_ROOT_KINDS = [
  'produce-book',
  'produce-book-existing',
  'produce-book-resume',
  'write-next-chapter',
  'chapter-write-harness',
  'pilot',
] as const;

/**
 * 立项 / 单章 scout / 设计 review 类 root run kinds（聊天侧 agent 共用同一互斥锁）
 */
export const BRAINSTORM_ROOT_KINDS = [
  'brainstorm-turn',
  'brainstorm-harness',
  'design-review-turn',
  'design-review-harness',
  'chapter-scout-turn',
  'chapter-scout-harness',
] as const;

/**
 * 设计类 root run kinds
 */
export const DESIGN_ROOT_KINDS = ['design-book', 'story-designer'] as const;

const BUSY_KINDS_BY_GROUP = {
  writing: WRITING_ROOT_KINDS as readonly string[],
  brainstorm: BRAINSTORM_ROOT_KINDS as readonly string[],
  design: DESIGN_ROOT_KINDS as readonly string[],
} as const;

export type BusyGroup = keyof typeof BUSY_KINDS_BY_GROUP;

export interface BookBusyState {
  bookId: string;
  writing: boolean;
  brainstorm: boolean;
  design: boolean;
  /** 各组当前在跑的 root kinds，UI 提示用 */
  activeKinds: { writing: string[]; brainstorm: string[]; design: string[] };
  /** 还在 pg-boss 队列里没起跑的 batch_jobs 数（writing 组也算它） */
  pendingBatchJobs: number;
  /**
   * 这本书最早一条 pending 的 gate（FIFO）。produce-book-existing 创建 gate-1
   * 后函数返回但 root run 仍 status=running，所以 writing 会一直 true——
   * 此字段让 UI 区分"真在写"vs"在等用户点确认"，给一个引到书详情页的 affordance。
   */
  awaitingGate: { gateId: string; kind: GateKind } | null;
  checkedAt: string;
}

const ALL_TRACKED_KINDS = [
  ...WRITING_ROOT_KINDS,
  ...BRAINSTORM_ROOT_KINDS,
  ...DESIGN_ROOT_KINDS,
] as const;

interface RunRow {
  kind: string;
}

/**
 * 查一本书有没有用户主动触发的 root run / batch_job 在跑或排队，按三组返回。
 * 后台维护类（arc-summarizer / book-summarizer / living-doc-updater 等）不算 busy。
 */
export async function loadBookBusyState(bookId: string): Promise<BookBusyState> {
  const [activeRows, pendingBatchRows, pendingGateRows] = await Promise.all([
    db
      .select({ kind: runs.kind })
      .from(runs)
      .where(
        and(
          eq(runs.bookId, bookId),
          isNull(runs.parentId),
          inArray(runs.status, ['pending', 'running']),
          inArray(runs.kind, ALL_TRACKED_KINDS as unknown as string[]),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(batchJobs)
      .where(and(eq(batchJobs.bookId, bookId), inArray(batchJobs.status, ['pending', 'running']))),
    db
      .select({ id: gateRequests.id, kind: gateRequests.kind })
      .from(gateRequests)
      .where(and(eq(gateRequests.bookId, bookId), eq(gateRequests.status, 'pending')))
      .orderBy(asc(gateRequests.createdAt))
      .limit(1),
  ]);

  const activeKinds = { writing: [] as string[], brainstorm: [] as string[], design: [] as string[] };
  for (const r of activeRows as RunRow[]) {
    for (const group of Object.keys(BUSY_KINDS_BY_GROUP) as BusyGroup[]) {
      if (BUSY_KINDS_BY_GROUP[group].includes(r.kind)) {
        activeKinds[group].push(r.kind);
        break;
      }
    }
  }
  const pendingBatchJobs = pendingBatchRows[0]?.count ?? 0;
  const gateRow = pendingGateRows[0];
  const awaitingGate = gateRow ? { gateId: gateRow.id, kind: gateRow.kind as GateKind } : null;

  return {
    bookId,
    writing: activeKinds.writing.length > 0 || pendingBatchJobs > 0,
    brainstorm: activeKinds.brainstorm.length > 0,
    design: activeKinds.design.length > 0,
    activeKinds,
    pendingBatchJobs,
    awaitingGate,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 服务端入口防御：用户连点 / race condition 时拒绝重复触发。
 * 抛 BookBusyError，前端可识别后展示更友好的提示。
 */
export class BookBusyError extends Error {
  readonly code = 'BOOK_BUSY';
  constructor(
    public readonly group: BusyGroup,
    public readonly state: BookBusyState,
  ) {
    const kinds = state.activeKinds[group].join(', ') || '排队中';
    const extra = group === 'writing' && state.pendingBatchJobs > 0
      ? `（含 ${state.pendingBatchJobs} 个待执行的 batch job）`
      : '';
    super(`这本书的「${groupLabel(group)}」流程正在进行中：${kinds}${extra}。请等当前流程跑完再触发。`);
    this.name = 'BookBusyError';
  }
}

function groupLabel(group: BusyGroup): string {
  switch (group) {
    case 'writing':
      return '写章';
    case 'brainstorm':
      return '立项 / scout';
    case 'design':
      return '设计';
  }
}

/**
 * 在 server fn 入口调用：发现该组已 busy 就 throw。
 */
export async function assertBookNotBusy(bookId: string, group: BusyGroup): Promise<BookBusyState> {
  const state = await loadBookBusyState(bookId);
  if (state[group]) throw new BookBusyError(group, state);
  return state;
}
