import 'dotenv/config';
import { writeNextChapter } from '../app/server/services/book-producer.ts';

const bookId = 'bb956b11-dc7f-477d-b003-b23a36876a54';

async function main() {
  console.log('=== 生成下一章 ===');
  const result = await writeNextChapter(bookId);
  console.log(`生成完成：第${result.idx}章，${result.charCount}字，killed=${result.killed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e?.message ?? e);
  process.exit(1);
});
