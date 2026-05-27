import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { elementCurator } from './agents/element-curator.ts';
import { chapterWriter } from './agents/chapter-writer.ts';
import { consistencyGuard } from './agents/consistency-guard.ts';
import { topicScout } from './agents/topic-scout.ts';
import { hookSmith } from './agents/hook-smith.ts';
import { arcSummarizer, bookSummarizer } from './agents/arc-summarizer.ts';
import { planReviser } from './agents/plan-reviser.ts';
import { qualityLinter } from './agents/quality-linter.ts';

// 注：story-designer 已从 schema-driven Agent 改为 harness（services/
// story-designer-harness.ts），不再注册到 Mastra；prompt 入 db slug
// 'story-designer-skill.system'。
// 风格指纹三件套（distiller / tweaker / polisher）已删，风格统一走 vault
// docs(kind='style', ...) 路径。
export const mastra = new Mastra({
  agents: {
    'element-curator': elementCurator,
    'chapter-writer': chapterWriter,
    'consistency-guard': consistencyGuard,
    'topic-scout': topicScout,
    'hook-smith': hookSmith,
    'arc-summarizer': arcSummarizer,
    'book-summarizer': bookSummarizer,
    'plan-reviser': planReviser,
    'quality-linter': qualityLinter,
  },
  logger: new PinoLogger({ name: 'lianyun', level: 'info' }),
});

export type AppMastra = typeof mastra;
