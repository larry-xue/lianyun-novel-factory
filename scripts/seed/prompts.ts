import { LIVING_DOC_UPDATER_PROMPT } from '../../app/server/mastra/agents/living-doc-updater.ts';
import { CHAPTER_WRITER_HARNESS_SYSTEM } from '../../app/server/prompts/chapter-writer.harness.system.ts';
import { BRAINSTORM_SKILL_PROMPT } from '../../app/server/prompts/brainstorm-skill.system.ts';
import { DESIGN_REVIEW_SKILL_PROMPT } from '../../app/server/prompts/design-review-skill.system.ts';
import { STORY_DESIGNER_SKILL_PROMPT } from '../../app/server/prompts/story-designer-skill.system.ts';
import { getPrompt, savePrompt } from '../../app/server/services/prompts.ts';

interface PromptSeed {
  slug: string;
  agentId: string;
  title: string;
  templateMd: string;
  notesMd: string;
}

/**
 * 缺失的 prompts seed。db 已存在的 slug 默认 skip（保留 UI 可能编辑过的版本）。
 *
 * 当前 db 已有：
 *   chapter-planner.system / chapter-writer.system / consistency-guard.system /
 *   quality-linter.system / topic-scout.system
 *
 * 缺失（log 里看到 loadPromptOrFallback 失败）：
 *   story-designer.system / living-doc-updater.system / chapter-writer.harness.system
 */
const SEED: PromptSeed[] = [
  {
    slug: 'living-doc-updater.system',
    agentId: 'living-doc-updater',
    title: '活文档维护员 system prompt',
    templateMd: LIVING_DOC_UPDATER_PROMPT,
    notesMd:
      '章节写完后自动更新活文档（character / lore / relations 等）。当前 chapter-writer harness 内的 update_doc 工具已默认接入，本 agent 主要给非 harness 路径用。',
  },
  {
    slug: 'chapter-writer.harness.system',
    agentId: 'chapter-writer',
    title: '章节写手 (harness 模式) system prompt',
    templateMd: CHAPTER_WRITER_HARNESS_SYSTEM,
    notesMd:
      'Claude-Code 风格 harness writer 的 system prompt。教 writer：信息已就位、不要 list/read/grep、单 turn 直接写 + submit_chapter。chapter-writer-harness.ts 当前直接用常量；接入 db 后 UI 可编辑。',
  },
  {
    slug: 'brainstorm-skill.system',
    agentId: 'brainstorm-scout',
    title: '立项 brainstorm skill system prompt',
    templateMd: BRAINSTORM_SKILL_PROMPT,
    notesMd:
      '立项 chat 的 harness skill。仿 obra/superpowers brainstorming skill：先探索 KB 武装自己，每轮 ask_user 一题（multi-choice 优先），所有必填决策齐了再 confirm_topic。HARD-GATE 阻止过早 confirm。',
  },
  {
    slug: 'design-review-skill.system',
    agentId: 'design-review',
    title: '设计 review skill system prompt',
    templateMd: DESIGN_REVIEW_SKILL_PROMPT,
    notesMd:
      '立项 confirm 后接管 chat。工具：read_design / update_design / regenerate_design / ask_user / start_writing。第一轮先 read story-concept + ask_user 给摘要。改一两段用 update_design，整体重做用 regenerate_design。',
  },
  {
    slug: 'story-designer-skill.system',
    agentId: 'story-designer',
    title: '故事设计师 (harness) system prompt',
    templateMd: STORY_DESIGNER_SKILL_PROMPT,
    notesMd:
      '立项 confirm 之后一气呵成产出整本书的活文档 vault。工具：list_kb / read_kb / grep_kb / update_doc / submit_design。slug 自由（character / world / style / relations + 题材自创 kind），支持 / 划多级。风格走 kind=style 活文档自然注入 chapter-writer。submit_design 时把 brief 元数据落 books 表，pending docs 落 book_docs。',
  },
];

export async function seedPrompts(): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const p of SEED) {
    const existing = await getPrompt(p.slug);
    if (existing) {
      // 不覆盖：保留 UI/人工编辑过的版本
      skipped++;
      continue;
    }
    await savePrompt({
      slug: p.slug,
      agentId: p.agentId,
      role: 'system',
      title: p.title,
      templateMd: p.templateMd,
      notesMd: p.notesMd,
      editedBy: 'agent',
      reasonMd: 'seed: 从 agent 文件常量初始化',
    });
    inserted++;
  }
  return { inserted, skipped };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  seedPrompts()
    .then(({ inserted, skipped }) => {
      console.log(`✓ prompts seeded: ${inserted} inserted, ${skipped} skipped`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
