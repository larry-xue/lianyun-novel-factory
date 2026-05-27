import 'dotenv/config';
import { db } from '../app/server/db/client.ts';
import { outlineNodes, chapters, bookStates } from '../app/server/db/schema/index.ts';
import { eq, asc } from 'drizzle-orm';

const bookId = 'bb956b11-dc7f-477d-b003-b23a36876a54';

const nodes = await db.select({
  id: outlineNodes.id,
  parentId: outlineNodes.parentId,
  level: outlineNodes.level,
  idx: outlineNodes.idx,
  title: outlineNodes.title,
  status: outlineNodes.status,
}).from(outlineNodes).where(eq(outlineNodes.bookId, bookId)).orderBy(asc(outlineNodes.level), asc(outlineNodes.idx));

console.log('=== outline_nodes ===');
for (const n of nodes) {
  const parent = n.parentId ? n.parentId.slice(0, 8) : 'null   ';
  console.log(`  [${n.level.padEnd(7)}] idx=${String(n.idx).padStart(3)} parent=${parent} status=${n.status.padEnd(8)} title=${n.title.slice(0, 40)}`);
}

const ch = await db.select({
  idx: chapters.idx,
  title: chapters.title,
  charCount: chapters.charCount,
}).from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.idx));

console.log('\n=== chapters ===');
for (const c of ch) {
  console.log(`  第${String(c.idx).padStart(3)}章 ${c.title} (${c.charCount}字)`);
}

process.exit(0);
