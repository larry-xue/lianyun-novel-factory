import 'dotenv/config';
import { CONSISTENCY_GUARD_PROMPT } from '../app/server/mastra/agents/consistency-guard.ts';
import { CHAPTER_WRITER_PROMPT } from '../app/server/mastra/agents/chapter-writer.ts';
import { CHAPTER_PLANNER_PROMPT } from '../app/server/mastra/agents/chapter-planner.ts';
import { LIVING_DOC_UPDATER_PROMPT } from '../app/server/mastra/agents/living-doc-updater.ts';
import { QUALITY_LINTER_PROMPT } from '../app/server/mastra/agents/quality-linter.ts';
import { TOPIC_SCOUT_PROMPT } from '../app/server/mastra/agents/topic-scout.ts';
import { CHAPTER_WRITER_HARNESS_SYSTEM } from '../app/server/prompts/chapter-writer.harness.system.ts';
import { BRAINSTORM_SKILL_PROMPT } from '../app/server/prompts/brainstorm-skill.system.ts';
import { DESIGN_REVIEW_SKILL_PROMPT } from '../app/server/prompts/design-review-skill.system.ts';
import { STORY_DESIGNER_SKILL_PROMPT } from '../app/server/prompts/story-designer-skill.system.ts';
import { getPrompt, savePrompt } from '../app/server/services/prompts.ts';

/**
 * 把代码里 PROMPT 常量强制同步到 db prompts 表。
 *
 * 与 seed-prompts.ts / scripts/seed/prompts.ts 的区别：
 *   seed = "db 没有就 insert，已存在 skip"（保留 UI 编辑）
 *   sync = "代码常量是真理之源，强制覆盖到 db"
 *
 * 利用 savePrompt 幂等：templateMd 与现版完全一致 → skip 不写新版；
 * 不一致 → update + 版本+1（旧版自动落 promptRevisions，可回滚）。
 *
 * 跑：pnpm tsx scripts/sync-prompts.ts
 *
 * 注意：UI 上手工编辑过的 prompt 会被覆盖。需要保留时先在 /prompts UI 上看版本历史，
 * 或在 db 里直接改 templateMd。
 */

interface PromptDef {
  slug: string;
  agentId: string;
  title: string;
  templateMd: string;
  notesMd: string;
}

const PROMPTS: PromptDef[] = [
  {
    slug: 'consistency-guard.system',
    agentId: 'consistency-guard',
    title: '一致性守门员 · 系统提示',
    templateMd: CONSISTENCY_GUARD_PROMPT,
    notesMd: '从 fragment 拼装，去重逻辑下沉到 quality-linter deterministic 层。',
  },
  {
    slug: 'chapter-writer.system',
    agentId: 'chapter-writer',
    title: '章节写手 · 系统提示',
    templateMd: CHAPTER_WRITER_PROMPT,
    notesMd: '从 prompts/fragments 拼装，含免费阅读平台风格与硬禁令自查清单。',
  },
  {
    slug: 'chapter-writer.harness.system',
    agentId: 'chapter-writer',
    title: '章节写手 (harness 模式) system prompt',
    templateMd: CHAPTER_WRITER_HARNESS_SYSTEM,
    notesMd: 'Claude-Code 风格 harness writer：单 turn 直接写 + submit_chapter。',
  },
  {
    slug: 'chapter-planner.system',
    agentId: 'chapter-planner',
    title: '章节策划师 · 系统提示',
    templateMd: CHAPTER_PLANNER_PROMPT,
    notesMd: 'milestone + chapterBeats 两层动态规划。',
  },
  {
    slug: 'story-designer-skill.system',
    agentId: 'story-designer',
    title: '故事设计师 (harness) system prompt',
    templateMd: STORY_DESIGNER_SKILL_PROMPT,
    notesMd:
      '立项 confirm 之后一气呵成产出整本书的活文档 vault（自由 slug，character/world/style/relations + 题材自创 kind）。submit_design 时 brief 落 books 表。',
  },
  {
    slug: 'design-review-skill.system',
    agentId: 'design-review',
    title: '设计 review skill system prompt',
    templateMd: DESIGN_REVIEW_SKILL_PROMPT,
    notesMd:
      '立项 confirm 后接管 chat。read_design / update_design / regenerate_design / ask_user / start_writing。',
  },
  {
    slug: 'living-doc-updater.system',
    agentId: 'living-doc-updater',
    title: '活文档维护员 system prompt',
    templateMd: LIVING_DOC_UPDATER_PROMPT,
    notesMd: '章节写完后增量更新 character / lore / relations 等活文档。',
  },
  {
    slug: 'quality-linter.system',
    agentId: 'quality-linter',
    title: '质检守门员 · 系统提示',
    templateMd: QUALITY_LINTER_PROMPT,
    notesMd: 'LLM 语义层质检（视角越界 / 心理空洞 / 模板化情节等），与 deterministic 正则层互补。',
  },
  {
    slug: 'topic-scout.system',
    agentId: 'topic-scout',
    title: '选题侦察 · 系统提示',
    templateMd: TOPIC_SCOUT_PROMPT,
    notesMd: 'chat 立项流程的 agent。',
  },
  {
    slug: 'brainstorm-skill.system',
    agentId: 'brainstorm-scout',
    title: '立项 brainstorm skill system prompt',
    templateMd: BRAINSTORM_SKILL_PROMPT,
    notesMd:
      '立项 chat 的 harness skill：先探索 KB、每轮 ask_user 一题、所有必填决策齐了 confirm_topic。HARD-GATE 阻止过早 confirm。',
  },
];

let inserted = 0;
let updated = 0;
let unchanged = 0;

for (const p of PROMPTS) {
  const existing = await getPrompt(p.slug);
  const willInsert = !existing;
  const willUpdate = !!existing && existing.templateMd !== p.templateMd;

  await savePrompt({
    slug: p.slug,
    agentId: p.agentId,
    role: 'system',
    title: p.title,
    templateMd: p.templateMd,
    notesMd: p.notesMd,
    editedBy: 'agent',
    reasonMd: 'sync: 从 agent 文件常量强制同步',
  });

  if (willInsert) {
    inserted++;
    console.log(`+ ${p.slug}  (v1 inserted)`);
  } else if (willUpdate) {
    updated++;
    console.log(`✱ ${p.slug}  (v${existing.version} → v${existing.version + 1})`);
  } else {
    unchanged++;
    console.log(`= ${p.slug}  (unchanged, v${existing.version})`);
  }
}

console.log(
  `\nsync 完成：${inserted} inserted, ${updated} updated, ${unchanged} unchanged`,
);
process.exit(0);
