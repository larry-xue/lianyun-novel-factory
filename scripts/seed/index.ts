import 'dotenv/config';
import { seedElements } from './elements.ts';
import { seedPrompts } from './prompts.ts';

async function main() {
  console.log('seeding…');
  const elements = await seedElements();
  console.log(`elements: ${elements} upserted`);
  const prompts = await seedPrompts();
  console.log(`prompts: ${prompts.inserted} inserted, ${prompts.skipped} skipped`);
  console.log('✓ seed done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
