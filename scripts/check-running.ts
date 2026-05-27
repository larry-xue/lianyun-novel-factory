import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import { runs } from '../app/server/db/schema/index.ts';

const r = await db.select().from(runs).where(eq(runs.status, 'running'));
for (const x of r) {
  const startedAt = x.startedAt ? new Date(x.startedAt).getTime() : null;
  const ageMin = startedAt ? Math.round((Date.now() - startedAt) / 60000) : '?';
  console.log(
    x.kind.padEnd(22),
    'started',
    ageMin,
    'min ago, parent=',
    x.parentId?.slice(0, 8) ?? '-',
    'id=',
    x.id.slice(0, 8),
  );
}
process.exit(0);
