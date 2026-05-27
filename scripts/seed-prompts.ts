import 'dotenv/config';
import { CONSISTENCY_GUARD_PROMPT } from '../app/server/mastra/agents/consistency-guard.ts';
import { CHAPTER_WRITER_PROMPT } from '../app/server/mastra/agents/chapter-writer.ts';
import { TOPIC_SCOUT_PROMPT } from '../app/server/mastra/agents/topic-scout.ts';
import { CHAPTER_PLANNER_PROMPT } from '../app/server/mastra/agents/chapter-planner.ts';
import { QUALITY_LINTER_PROMPT } from '../app/server/mastra/agents/quality-linter.ts';
import { savePrompt } from '../app/server/services/prompts.ts';

/**
 * Seed 现有 agent 的 SYSTEM 模板进 prompts 表（POC）。
 * 后续 agent 可通过 loadPrompt('chapter-writer.system') 取最新版而非硬编码。
 *
 * 跑：pnpm tsx scripts/seed-prompts.ts
 */

const seeds = [
  {
    slug: 'consistency-guard.system',
    agentId: 'consistency-guard',
    role: 'system' as const,
    title: '一致性守门员 · 系统提示',
    templateMd: CONSISTENCY_GUARD_PROMPT,
    variables: [],
    notesMd: '重构：去掉重复段落扫描（移到 quality-linter deterministic 层），从 fragment 拼装。',
  },
  {
    slug: 'chapter-writer.system',
    agentId: 'chapter-writer',
    role: 'system' as const,
    title: '章节写手 · 系统提示',
    templateMd: CHAPTER_WRITER_PROMPT,
    variables: [],
    notesMd: '重构：从 prompts/fragments 拼装，加入免费阅读平台风格与 27 条硬禁令自查清单。',
  },
  {
    slug: 'chapter-planner.system',
    agentId: 'chapter-planner',
    role: 'system' as const,
    title: '章节策划师 · 系统提示',
    templateMd: CHAPTER_PLANNER_PROMPT,
    variables: [],
    notesMd: '重构：从 fragment 拼装，吸收叙事节奏 + 创作底线 fragment。',
  },
  {
    slug: 'quality-linter.system',
    agentId: 'quality-linter',
    role: 'system' as const,
    title: '质检守门员 · 系统提示',
    templateMd: QUALITY_LINTER_PROMPT,
    variables: [],
    notesMd: '新增：LLM 语义层质检（视角越界 / 心理空洞 / 模板化情节等），与 deterministic 正则层互补。',
  },
  {
    slug: 'topic-scout.system',
    agentId: 'topic-scout',
    role: 'system' as const,
    title: '选题侦察 · 系统提示',
    templateMd: TOPIC_SCOUT_PROMPT,
    variables: [],
    notesMd: 'S4 chat 立项流程的 agent。',
  },
];

let inserted = 0;
let skipped = 0;
for (const s of seeds) {
  try {
    await savePrompt({
      slug: s.slug,
      agentId: s.agentId,
      role: s.role,
      title: s.title,
      templateMd: s.templateMd,
      variables: s.variables,
      notesMd: s.notesMd,
      editedBy: 'human',
      reasonMd: 'seed: 从 agent 文件 SYSTEM 常量初始化',
    });
    inserted++;
    console.log(`✓ ${s.slug}`);
  } catch (e) {
    skipped++;
    console.warn(`✗ ${s.slug}: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\nseed 完成：${inserted} 新/更新，${skipped} 跳过`);
process.exit(0);
