import 'dotenv/config';
import { desc, eq } from 'drizzle-orm';
import { db } from '../app/server/db/client.ts';
import { chapters } from '../app/server/db/schema/index.ts';
import { runQualityLint, runDeterministicLint, detectDuplicateParagraphs } from '../app/server/services/quality-linter.ts';

const bookId = process.argv[2] || 'bb956b11-dc7f-477d-b003-b23a36876a54';
const limit = Number(process.argv[3] ?? '5');

const rows = await db
  .select({ idx: chapters.idx, title: chapters.title, contentMd: chapters.contentMd, charCount: chapters.charCount })
  .from(chapters)
  .where(eq(chapters.bookId, bookId))
  .orderBy(desc(chapters.idx))
  .limit(limit);

console.log(`\n=== Quality lint on ${rows.length} chapters of book ${bookId.slice(0, 8)} ===\n`);

let totalBlockers = 0;
let totalMajors = 0;
let totalMinors = 0;
const ruleCounts = new Map<string, number>();

for (const r of rows.reverse()) {
  const v = runQualityLint(r.contentMd);
  const blockers = v.hits.filter((h) => h.severity === 'blocker');
  const majors = v.hits.filter((h) => h.severity === 'major');
  const minors = v.hits.filter((h) => h.severity === 'minor');
  totalBlockers += blockers.length;
  totalMajors += majors.length;
  totalMinors += minors.length;

  console.log(
    `ch${r.idx.toString().padStart(2)} ${r.charCount}字  passed=${v.passed ? 'YES' : 'NO '}  ` +
      `blocker=${blockers.length}  major=${majors.length}  minor=${minors.length}  ${r.title}`,
  );

  // 按规则汇总
  const byRule = new Map<string, number>();
  for (const h of v.hits) {
    byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1);
    ruleCounts.set(h.rule, (ruleCounts.get(h.rule) ?? 0) + 1);
  }
  if (byRule.size > 0) {
    const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(
      '   命中：' +
        top
          .map(([k, n]) => {
            const sev = v.hits.find((h) => h.rule === k)!.severity[0]!.toUpperCase();
            return `[${sev}]${k}×${n}`;
          })
          .join('  '),
    );
    // 给出第一个 blocker 的样本
    const firstBlocker = blockers[0];
    if (firstBlocker) {
      const sample = r.contentMd.slice(Math.max(0, firstBlocker.position - 10), firstBlocker.position + 40);
      console.log(`   blocker 样本：…${sample}…`);
    }
  }
}

console.log(
  `\n=== 总计：blocker ${totalBlockers}  major ${totalMajors}  minor ${totalMinors} ===`,
);
console.log('\n规则命中频次（降序）：');
for (const [rule, n] of [...ruleCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule.padEnd(35)} ${n}`);
}

process.exit(0);
