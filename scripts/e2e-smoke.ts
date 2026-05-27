import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import {
  arcSummaries,
  bookStates,
  books,
  chapterRevisions,
  chapters,
  llmCalls,
  outlineRevisions,
  runs,
} from '../app/server/db/schema/index.ts';
import { loadLlmConfigFromDb } from '../app/server/llm/client.ts';
import { produceBook, writeNextChapter } from '../app/server/services/book-producer.ts';

// 优先用 db 里的 LLM 配置；db 没有时退回 .env。
// 让 web UI 改的配置自动应用到脚本，无需重启什么。
const dbCfg = await loadLlmConfigFromDb();
if (dbCfg) {
  console.log(`[e2e] LLM 配置来自 db：endpoint=${dbCfg.endpoint} model=${dbCfg.model}`);
}

/**
 * 一次真实 e2e 跑批，落库不清。
 * 用 `pnpm tsx scripts/e2e-smoke.ts`                    → 5 章快测
 *    `pnpm tsx scripts/e2e-smoke.ts --full`             → 20 章验收测
 *    `pnpm tsx scripts/e2e-smoke.ts --resume <bookId>`  → 续写已有书到 totalChapters
 */

const FULL = process.argv.includes('--full');
const resumeIdx = process.argv.indexOf('--resume');
const RESUME_BOOK_ID = resumeIdx >= 0 ? process.argv[resumeIdx + 1] : null;

const totalChapters = FULL ? 20 : 5;
const arcSummaryEvery = FULL ? 10 : 20;
const planRevisionEvery = FULL ? 10 : 0;

const t0 = Date.now();

let bookId: string;
let rootRunId: string;

if (RESUME_BOOK_ID) {
  console.log(`[e2e] 续写模式：书 ${RESUME_BOOK_ID}（目标 ${totalChapters} 章）`);
  console.log(`[e2e] 模型：${process.env.LLM_MODEL ?? 'gpt-4o-mini（默认）'}`);
  bookId = RESUME_BOOK_ID;
  rootRunId = '(各章独立 run)';

  while (true) {
    const existing = await db
      .select({ idx: chapters.idx })
      .from(chapters)
      .where(eq(chapters.bookId, bookId));
    const maxIdx = existing.reduce((acc, c) => Math.max(acc, c.idx), 0);
    if (maxIdx >= totalChapters) {
      console.log(`[e2e] 已写完 ${maxIdx}/${totalChapters} 章`);
      break;
    }
    try {
      const r = await writeNextChapter(bookId);
      console.log(`[e2e] 第 ${r.idx} 章：${r.charCount} 字${r.killed ? `（kill：${r.killReason}）` : ''}`);
      if (r.killed) break;
    } catch (e) {
      console.error(`[e2e] 第 ${maxIdx + 1} 章失败：${e instanceof Error ? e.message : e}`);
      break;
    }
  }
} else {
  console.log(`[e2e] 启动 produceBook（${totalChapters} 章 × 3000 字目标，${FULL ? '验收' : '快测'} 模式）`);
  console.log(`[e2e] 模型：${process.env.LLM_MODEL ?? 'gpt-4o-mini（默认）'}`);
  console.log(`[e2e] arcSummaryEvery=${arcSummaryEvery} planRevisionEvery=${planRevisionEvery}`);

  const r = await produceBook({
    topicTitle: '末世重生：囤货从今天开始',
    pitch:
      '社畜重生回末世爆发前 7 天，靠前世记忆 + 现代理财思维囤资源、组队伍、反向收割那些上辈子欺负过自己的人。',
    elementSlugs: ['post-apocalypse', 'rebirth', 'system-flow'],
    totalChapters,
    charsPerChapter: 3000,
    earlyKillBelowChars: 0,
    maxGuardRetries: 1,
    useHookSmith: true,
    arcSummaryEvery,
    planRevisionEvery,
  });
  bookId = r.bookId;
  rootRunId = r.rootRunId;
}

const ch = await db
  .select({
    idx: chapters.idx,
    title: chapters.title,
    charCount: chapters.charCount,
    status: chapters.status,
  })
  .from(chapters)
  .where(eq(chapters.bookId, bookId))
  .orderBy(chapters.idx);

const totalCharCount = ch.reduce((acc, c) => acc + c.charCount, 0);
const chaptersWritten = ch.length;
const averageCharCount = chaptersWritten ? Math.round(totalCharCount / chaptersWritten) : 0;

const [bookRow] = await db.select().from(books).where(eq(books.id, bookId));
const killed = bookRow?.status === 'killed';

const revs = await db
  .select({ chapterId: chapterRevisions.chapterId, kind: chapterRevisions.kind })
  .from(chapterRevisions);

const states = await db
  .select()
  .from(bookStates)
  .where(eq(bookStates.bookId, bookId));

const arcs = await db
  .select()
  .from(arcSummaries)
  .where(eq(arcSummaries.bookId, bookId));

const ors = await db
  .select()
  .from(outlineRevisions)
  .where(eq(outlineRevisions.bookId, bookId));

const runRows = await db.select().from(runs).where(eq(runs.bookId, bookId));

// 重试可见性：runs 用 inner join 拉 llm_calls 数量，差值 = 重试次数
const runIds = runRows.map((r) => r.id);
const llmCallRows = runIds.length
  ? await db.select({ runId: llmCalls.runId, errorMd: llmCalls.errorMd }).from(llmCalls)
  : [];
const callsForBook = llmCallRows.filter((c) => c.runId && runIds.includes(c.runId));
const failedCalls = callsForBook.filter((c) => c.errorMd != null);

console.log('');
console.log('========== 结果 ==========');
console.log(`bookId:           ${bookId}`);
console.log(`rootRunId:        ${rootRunId}`);
console.log(`chaptersWritten:  ${chaptersWritten}/${totalChapters}`);
console.log(`totalCharCount:   ${totalCharCount}`);
console.log(`averageCharCount: ${averageCharCount}`);
console.log(`book.status:      ${bookRow?.status ?? '?'}${killed ? ' (KILLED)' : ''}`);
console.log('');
console.log('== chapters ==');
// 字数验收：目标 3000，上限 +1000，下限 -300
const lowerOk = 3000 - 300;
const upperOk = 3000 + 1000;
for (const c of ch) {
  const flag = c.charCount >= lowerOk && c.charCount <= upperOk ? '✓' : '⚠';
  console.log(`  ${flag} 第 ${c.idx} 章 ${c.title} · ${c.charCount} 字 · ${c.status}`);
}
const revKinds = revs.reduce<Record<string, number>>((acc, r) => {
  acc[r.kind] = (acc[r.kind] ?? 0) + 1;
  return acc;
}, {});
console.log('');
console.log(`== chapter_revisions（聚合） == ${JSON.stringify(revKinds)}`);
console.log(`== book_states ==              ${states.length} 行`);
console.log(`== arc_summaries ==            ${arcs.length} 段`);
for (const a of arcs) {
  console.log(`     Arc ${a.arcIdx} ${a.arcName}（第 ${a.rangeStart}-${a.rangeEnd} 章）`);
}
console.log(`== outline_revisions ==        ${ors.length} 版`);
console.log(`== runs（这本书相关） ==        ${runRows.length} 条`);
const runKinds = runRows.reduce<Record<string, number>>((acc, r) => {
  acc[r.kind] = (acc[r.kind] ?? 0) + 1;
  return acc;
}, {});
console.log(`     ${JSON.stringify(runKinds)}`);
console.log(
  `== llm_calls ==                ${callsForBook.length} 次 · 失败 ${failedCalls.length} 次 · 重试 ${Math.max(0, callsForBook.length - runRows.length)} 次`,
);
const failedRunCount = runRows.filter((r) => r.status === 'failure').length;
console.log(`== runs failure ==             ${failedRunCount} 个`);
console.log('');
console.log(`总耗时：${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`数据已保留。可去 /books/${bookId} 和 /runs/${rootRunId} 查看。`);

process.exit(0);
