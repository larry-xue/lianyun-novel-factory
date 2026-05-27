import 'dotenv/config';
import { deleteLastChapter } from '../app/server/services/chapters.ts';
import { writeNextChapter } from '../app/server/services/book-producer.ts';

const bookId = 'bb956b11-dc7f-477d-b003-b23a36876a54';

async function main() {
  console.log('=== 删除第3章 ===');
  const del = await deleteLastChapter(bookId);
  console.log(`已删除：第${del.deletedIdx}章「${del.deletedTitle}」`);

  console.log('\n=== 重新生成第3章 ===');
  const result = await writeNextChapter(bookId);
  console.log(`生成完成：第${result.idx}章，${result.charCount}字，killed=${result.killed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e?.message ?? e);
  process.exit(1);
});
