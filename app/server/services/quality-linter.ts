/**
 * Quality Linter（deterministic 层）
 *
 * 章节产出后的第一道质检：用正则扫描可模式匹配的 AI 口癖、否定对比、弱转折、
 * 连续主语他/她、副词泛滥、重复段落。命中即返工，不烧 LLM token。
 *
 * 阈值：1 个 blocker 或 ≥3 个 major 视为失败。
 * 失败 → 拼 rewriteHintMd 给 chapter-writer 重写。
 */

export type LintSeverity = 'blocker' | 'major' | 'minor';

export interface LintHit {
  rule: string;
  severity: LintSeverity;
  match: string;
  position: number;
  fixHint: string;
}

export interface LintVerdict {
  passed: boolean;
  hits: LintHit[];
  rewriteHintMd: string;
}

interface LintRule {
  id: string;
  pattern: RegExp;
  severity: LintSeverity;
  fixHint: string;
  maxReportPerRule?: number;
}

const RULES: LintRule[] = [
  // §3 AI 口癖（major：模型最常踩的坑，不能放过）
  {
    id: 'ai-tic-zhijian',
    pattern: /只见(他|她|那|一|远|对|众)/g,
    severity: 'major',
    fixHint: '"只见"是典型 AI 口癖，删除并改写为聚焦角色的具体动作或感知',
  },
  {
    id: 'ai-tic-buyou',
    pattern: /不(由得|禁)/g,
    severity: 'major',
    fixHint: '"不由得/不禁"是 AI 口癖，用具体心理或动作替代',
  },
  {
    id: 'ai-tic-jiuzaizhe',
    pattern: /就在这时/g,
    severity: 'major',
    fixHint: '"就在这时"是 AI 衔接套话，用具体时间或动作过渡',
  },
  {
    id: 'ai-tic-pianke',
    pattern: /片刻(后|之后)/g,
    severity: 'minor',
    fixHint: '"片刻后"过于笼统，用更具体的时间或动作过渡',
  },
  {
    id: 'ai-tic-suiji',
    pattern: /(随即|于是|因此)/g,
    severity: 'minor',
    fixHint: '机械衔接词，用动作或自然过渡替代',
    maxReportPerRule: 3,
  },
  {
    id: 'ai-tic-sihu',
    pattern: /(似乎|仿佛|好像)/g,
    severity: 'minor',
    fixHint: '弱化感知词，用聚焦角色的明确判断或具体描写替代',
    maxReportPerRule: 3,
  },

  // §20 否定对比句式（blocker：用户红线）
  {
    id: 'forbidden-meiyou-meiyou',
    pattern: /没有[^。！？\n]{0,30}没有/g,
    severity: 'blocker',
    fixHint: '禁用"没有……没有……"否定对比句式，改为正面陈述',
  },
  {
    id: 'forbidden-bushi-ershi',
    pattern: /(不是|并非)[^。！？\n]{0,30}而是/g,
    severity: 'blocker',
    fixHint: '禁用"不是……而是……"否定对比句式，改为直接陈述事实',
  },
  {
    id: 'forbidden-meiyou-zhishi',
    pattern: /没有[^。！？\n]{0,30}只是/g,
    severity: 'blocker',
    fixHint: '禁用"没有……只是……"否定对比句式，直接说"只是……"',
  },
  {
    id: 'forbidden-meiyou-yemeiyou',
    pattern: /没有[^。！？\n]{0,30}也没有/g,
    severity: 'blocker',
    fixHint: '禁用"没有……也没有……"否定对比句式',
  },

  // §21 弱转折句式（blocker：用户红线）
  {
    id: 'forbidden-suiran-danshi',
    pattern: /虽然[^。！？\n]{0,40}但是/g,
    severity: 'blocker',
    fixHint: '禁用"虽然……但是……"弱转折，改为直接对比或省略转折词',
  },
  {
    id: 'forbidden-jinguan-que',
    pattern: /尽管[^。！？\n]{0,40}却/g,
    severity: 'blocker',
    fixHint: '禁用"尽管……却……"弱转折',
  },
  {
    id: 'forbidden-bingbu-que',
    pattern: /并不[^。！？\n]{0,30}却/g,
    severity: 'blocker',
    fixHint: '禁用"并不……却……"弱转折',
  },
  {
    id: 'forbidden-shenzhi-meiyou',
    pattern: /甚至[^。！？\n]{0,30}没有/g,
    severity: 'major',
    fixHint: '"甚至……没有……"是弱转折模板，用更具体的对比表达替代',
  },

  // §22 连续主语他/她
  {
    id: 'forbidden-tata-chain',
    pattern: /(^|[。！？])\s*(他|她)[^。！？\n]{1,40}[。！？]\s*(他|她)[^。！？\n]{1,40}[。！？]\s*(他|她)/gm,
    severity: 'major',
    fixHint: '连续 3 句以上以"他/她"开头，合并动作描写或换主语呈现方式',
  },

  // §3 副词泛滥
  {
    id: 'forbidden-fuci',
    pattern: /(非常|极其|格外|稍稍|默默)/g,
    severity: 'minor',
    fixHint: '凑数副词（非常/极其/格外/稍稍/默默），用具体动作或细节替代',
    maxReportPerRule: 3,
  },
];

export function runDeterministicLint(contentMd: string): LintHit[] {
  const hits: LintHit[] = [];
  for (const rule of RULES) {
    let count = 0;
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(contentMd)) !== null) {
      count += 1;
      const max = rule.maxReportPerRule ?? Infinity;
      if (count > max) break;
      hits.push({
        rule: rule.id,
        severity: rule.severity,
        match: m[0],
        position: m.index,
        fixHint: rule.fixHint,
      });
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1;
    }
  }
  return hits;
}

/**
 * 重复段落检测：按自然段拆分，找到完全相同的段落对（normalize 空白后比较）。
 * 重复 = blocker（一段出现两次以上整章必须重写）。
 */
export function detectDuplicateParagraphs(contentMd: string): LintHit[] {
  const hits: LintHit[] = [];
  const paragraphs = contentMd.split(/\n{2,}/);
  const seen = new Map<string, { idx: number; offset: number }>();
  let offset = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const raw = paragraphs[i] ?? '';
    const para = raw.trim();
    if (para.length >= 20) {
      const key = para.replace(/\s+/g, '');
      const prev = seen.get(key);
      if (prev !== undefined) {
        hits.push({
          rule: 'duplicate-paragraph',
          severity: 'blocker',
          match: para.slice(0, 40),
          position: offset,
          fixHint: `第 ${prev.idx + 1} 段与第 ${i + 1} 段完全相同（开头："${para.slice(0, 30)}…"），删除重复并改写为推进剧情的新内容`,
        });
      } else {
        seen.set(key, { idx: i, offset });
      }
    }
    offset += raw.length + 2; // +2 是 \n\n 长度
  }
  return hits;
}

/**
 * 汇总所有 hit，判定是否需要返工，并拼好 rewriteHintMd。
 *
 * 阈值：
 * - 1 个 blocker → fail
 * - ≥3 个 major → fail
 * - 否则 pass（minor 仅记录）
 */
export function summarizeLint(hits: LintHit[]): LintVerdict {
  const blockers = hits.filter((h) => h.severity === 'blocker');
  const majors = hits.filter((h) => h.severity === 'major');
  const minors = hits.filter((h) => h.severity === 'minor');
  const passed = blockers.length === 0 && majors.length < 3;

  if (passed) {
    return { passed: true, hits, rewriteHintMd: '' };
  }

  const groups = new Map<string, LintHit[]>();
  for (const h of [...blockers, ...majors]) {
    const arr = groups.get(h.rule) ?? [];
    arr.push(h);
    groups.set(h.rule, arr);
  }

  const lines: string[] = ['## 质检命中（deterministic 层）', '', '本章命中以下硬性禁令，重写时必须全部改掉：', ''];
  for (const [, arr] of groups) {
    const example = arr[0]!;
    const samples = arr.slice(0, 3).map((h) => `"${h.match}"`).join('、');
    lines.push(`- [${example.severity}] ${example.fixHint}（命中 ${arr.length} 处，例：${samples}）`);
  }
  if (minors.length > 0) {
    lines.push('', `（另有 ${minors.length} 处 minor 提示，未阻塞但建议改善）`);
  }
  lines.push('', '重写要求：以上每一类问题在新版本里必须 0 命中，正文整体保持原剧情走向，仅改写句式与措辞。');

  return { passed: false, hits, rewriteHintMd: lines.join('\n') };
}

/**
 * 一键跑全套：正则 + 重复段落检测 + 汇总。
 */
export function runQualityLint(contentMd: string): LintVerdict {
  const hits = [...runDeterministicLint(contentMd), ...detectDuplicateParagraphs(contentMd)];
  return summarizeLint(hits);
}

/**
 * 章级 quality gate：deterministic 正则层 + LLM 语义/契约/接续层。
 *
 * 调用顺序：
 * 1. 跑 runQualityLint（regex）—— 快、便宜，AI 口癖 / 否定对比 / 弱转折 / 重复段落
 *    失败 → 直接返回 regex rewriteHint，不烧 LLM token
 * 2. 跑 qualityLinter agent —— LLM 层，需要 books.protagonist / prohibited_tropes /
 *    canonical-numbers / cast / lastHookMd 才能判 POV/红线/数字漂移/章末 hook 接续。
 *    failed → 用 LLM rewriteHint
 *
 * 风格通过 vault docs(kind='style', ...) 路径自然进入 chapter-writer prompt，
 * quality-linter 不再单独检查 style-profile-mismatch。
 *
 * 接入位置：chapter-writer 出稿后、入库前；retry 由调用方控制。
 */
import { qualityLinter, QualityLintReportSchema, type QualityLintReport } from '../mastra/agents/quality-linter.ts';
import { runChildAgent } from './run-tracer.ts';

export interface ChapterQualityGateInput {
  rootRunId: string;
  bookId: string;
  chapterIdx: number;
  chapterTitle: string;
  chapterContentMd: string;
  protagonist: string;
  prohibitedTropes: string[];
  canonicalNumbersMd: string;
  castMd: string;
  lastHookMd: string;
  bookTitle: string;
  audience: string;
  mainArcMd: string;
}

export interface ChapterQualityGateResult {
  passed: boolean;
  rewriteHintMd: string;
  /** deterministic 层（regex + 重复段落）verdict */
  deterministic: LintVerdict;
  /** LLM 层 report；deterministic 层失败时不会跑 LLM，此字段为 undefined */
  llmReport?: QualityLintReport;
}

export async function runChapterQualityGate(
  opts: ChapterQualityGateInput,
): Promise<ChapterQualityGateResult> {
  // Step 1: deterministic（fail fast，省 LLM token）
  const deterministic = runQualityLint(opts.chapterContentMd);
  if (!deterministic.passed) {
    return {
      passed: false,
      rewriteHintMd: deterministic.rewriteHintMd,
      deterministic,
    };
  }

  // Step 2: LLM 语义/契约/接续层
  const tropesBlock =
    opts.prohibitedTropes.length > 0
      ? opts.prohibitedTropes.map((t) => `- ${t}`).join('\n')
      : '（未指定题材红线；按主分类自行评估题材边界）';
  const lastHookBlock = opts.lastHookMd
    ? opts.lastHookMd
    : '（本章是第 1 章或上一章未记录 hook；不需要做 last-hook-broken 检查）';

  const prompt = [
    `# 待审章节`,
    `书名：《${opts.bookTitle}》`,
    `主角（POV 锁）：${opts.protagonist || '（未设）'}`,
    `面向：${opts.audience}`,
    `主线：${opts.mainArcMd}`,
    `本章号：第 ${opts.chapterIdx} 章`,
    `本章标题：${opts.chapterTitle}`,
    ``,
    `## 题材红线（books.prohibited_tropes）`,
    tropesBlock,
    ``,
    `## canonical-numbers（数字一致性参考）`,
    opts.canonicalNumbersMd || '（暂无；如本章引用数字型设定，提示 writer 维护 canonical-numbers）',
    ``,
    `## cast（在场角色台账，POV 锁参考）`,
    opts.castMd || '（暂无 cast 台账）',
    ``,
    `## 上一章末尾原文 hook（接续检查参考）`,
    lastHookBlock,
    ``,
    `## 本章正文`,
    opts.chapterContentMd,
    ``,
    `## 任务`,
    `按 system prompt 中 kind 全面检查，输出 JSON 报告。`,
    `特别留意：契约层（genre-trope-violation / canonical-number-drift / last-hook-broken）任一项 blocker 都要 reject。`,
  ].join('\n');

  const { result: llmReport } = await runChildAgent({
    kind: 'quality-linter',
    parentRunId: opts.rootRunId,
    bookId: opts.bookId,
    input: { chapterIdx: opts.chapterIdx },
    agent: qualityLinter,
    schema: QualityLintReportSchema,
    prompt,
  });

  if (llmReport.passed) {
    return {
      passed: true,
      rewriteHintMd: '',
      deterministic,
      llmReport,
    };
  }

  // LLM fail：用 LLM 的 rewriteHintMd（已经是聚合好的指令）
  return {
    passed: false,
    rewriteHintMd:
      llmReport.rewriteHintMd && llmReport.rewriteHintMd.length > 0
        ? llmReport.rewriteHintMd
        : buildFallbackHintFromIssues(llmReport),
    deterministic,
    llmReport,
  };
}

function buildFallbackHintFromIssues(report: QualityLintReport): string {
  const lines: string[] = ['## quality-linter LLM 层命中', '', report.summaryMd, '', '本章必须修复以下问题：', ''];
  for (const issue of report.issues) {
    lines.push(`- [${issue.severity}] (${issue.kind}) ${issue.fixMd}`);
    lines.push(`  证据："${issue.evidenceMd.slice(0, 80)}"`);
  }
  return lines.join('\n');
}
