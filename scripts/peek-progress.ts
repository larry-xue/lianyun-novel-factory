import 'dotenv/config';
import { desc } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import { chapters, runs } from '../app/server/db/schema/index.ts';

const recent = await db
  .select({
    id: runs.id,
    kind: runs.kind,
    status: runs.status,
    parentId: runs.parentId,
    bookId: runs.bookId,
    started: runs.startedAt,
    finished: runs.finishedAt,
  })
  .from(runs)
  .orderBy(desc(runs.createdAt))
  .limit(20);

console.log('recent runs:');
for (const r of recent) {
  const ms =
    r.finished && r.started
      ? new Date(r.finished).getTime() - new Date(r.started).getTime()
      : null;
  console.log(
    `  [${r.status.padEnd(8)}] ${r.kind.padEnd(20)} parent=${r.parentId?.slice(0, 8) ?? '-'} ${ms != null ? ms + 'ms' : 'running'}`,
  );
}

const ch = await db
  .select({
    idx: chapters.idx,
    title: chapters.title,
    charCount: chapters.charCount,
    bookId: chapters.bookId,
  })
  .from(chapters)
  .orderBy(desc(chapters.createdAt))
  .limit(8);

console.log('\nrecent chapters:');
for (const c of ch)
  console.log(`  bookId=${c.bookId.slice(0, 8)} ch${c.idx} ${c.charCount} 字 - ${c.title}`);

process.exit(0);
