import 'dotenv/config';
import { writeNextChapter } from '../app/server/services/book-producer.ts';

const bookId = 'bb956b11-dc7f-477d-b003-b23a36876a54';

async function main() {
  for (let i = 2; i <= 3; i++) {
    console.log(`\n=== 生成第${i}章 ===`);
    const result = await writeNextChapter(bookId);
    console.log(`第${result.idx}章，${result.charCount}字，killed=${result.killed}`);
    if (i < 3) {
      console.log('等待 10 秒...');
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('失败:', e?.message ?? e);
  process.exit(1);
});
