import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import {
  antiPatterns,
  bookStates,
  books,
  chapterRevisions,
  chapters,
  characters,
  elements,
  hooks,
  llmCalls,
  runs,
  styleSamples,
  topicCards,
} from './schema/index.ts';

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug 只能含小写字母、数字和短横线');

export const ElementSelect = createSelectSchema(elements);
export const ElementInsert = createInsertSchema(elements, {
  slug,
  zh: (s) => s.min(1).max(32),
  category: (s) => s.min(1).max(32),
  hotScore: (s) => s.min(0).max(1),
});
export const ElementUpdate = createUpdateSchema(elements, {
  slug: slug.optional(),
});
export type ElementSelectT = z.infer<typeof ElementSelect>;
export type ElementInsertT = z.infer<typeof ElementInsert>;

export const StyleSampleSelect = createSelectSchema(styleSamples);
export const StyleSampleInsert = createInsertSchema(styleSamples);

export const TopicCardSelect = createSelectSchema(topicCards);
export const TopicCardInsert = createInsertSchema(topicCards);

export const BookSelect = createSelectSchema(books);
export const BookInsert = createInsertSchema(books);

export const CharacterSelect = createSelectSchema(characters);
export const CharacterInsert = createInsertSchema(characters);

export const BookStateSelect = createSelectSchema(bookStates);
export const BookStateInsert = createInsertSchema(bookStates);

export const ChapterSelect = createSelectSchema(chapters);
export const ChapterInsert = createInsertSchema(chapters);

export const ChapterRevisionSelect = createSelectSchema(chapterRevisions);
export const ChapterRevisionInsert = createInsertSchema(chapterRevisions);

export const HookSelect = createSelectSchema(hooks);
export const HookInsert = createInsertSchema(hooks);

export const AntiPatternSelect = createSelectSchema(antiPatterns);
export const AntiPatternInsert = createInsertSchema(antiPatterns);

export const RunSelect = createSelectSchema(runs);
export const RunInsert = createInsertSchema(runs);

export const LlmCallSelect = createSelectSchema(llmCalls);
export const LlmCallInsert = createInsertSchema(llmCalls);
