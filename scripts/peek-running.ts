import 'dotenv/config';
import { desc, eq } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import { runs } from '../app/server/db/schema/index.ts';

const running = await db
  .select()
  .from(runs)
  .where(eq(runs.status, 'running'))
  .orderBy(desc(runs.createdAt))
  .limit(20);

console.log(`running runs: ${running.length}`);
for (const r of running) {
  const startedMs = r.startedAt
    ? Date.now() - new Date(r.startedAt).getTime()
    : null;
  console.log(
    `  [${new Date(r.createdAt).toLocaleTimeString('zh-CN')}] ${r.kind.padEnd(20)} parent=${r.parentId?.slice(0, 8) ?? '-'} elapsed=${startedMs != null ? Math.round(startedMs / 1000) + 's' : '-'}`,
  );
}
process.exit(0);
