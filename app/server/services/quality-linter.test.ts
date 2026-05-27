import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  detectDuplicateParagraphs,
  runChapterQualityGate,
  runDeterministicLint,
  runQualityLint,
  summarizeLint,
} from './quality-linter.ts';
import { db } from '../db/client.ts';
import { books, runs } from '../db/schema/index.ts';
import { resetLlmClientForTests } from '../llm/client.ts';

describe('runDeterministicLint - AI 口癖', () => {
  it('命中 "只见他"', () => {
    const hits = runDeterministicLint('只见他走过门口，叹了口气。');
    expect(hits.find((h) => h.rule === 'ai-tic-zhijian')).toBeDefined();
  });

  it('命中 "不由得 / 不禁"', () => {
    const hits = runDeterministicLint('他不由得抬头看了一眼。她不禁笑了起来。');
    const matched = hits.filter((h) => h.rule === 'ai-tic-buyou');
    expect(matched.length).toBeGreaterThanOrEqual(2);
  });

  it('命中 "就在这时"', () => {
    const hits = runDeterministicLint('就在这时，门外传来脚步声。');
    expect(hits.find((h) => h.rule === 'ai-tic-jiuzaizhe')).toBeDefined();
  });

  it('干净文本 0 命中', () => {
    const clean = '林越推开门，灯光从缝隙里漏出来。屋里没人，桌上一杯凉透的茶。';
    expect(runDeterministicLint(clean)).toEqual([]);
  });
});

describe('runDeterministicLint - 否定对比 blocker', () => {
  it('命中 "不是…而是…"', () => {
    const hits = runDeterministicLint('他要的不是这个答案，而是真相。');
    const hit = hits.find((h) => h.rule === 'forbidden-bushi-ershi');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('blocker');
  });

  it('命中 "没有…没有…"', () => {
    const hits = runDeterministicLint('屋里没有声音，也没有光。');
    expect(hits.find((h) => h.rule === 'forbidden-meiyou-yemeiyou' || h.rule === 'forbidden-meiyou-meiyou')).toBeDefined();
  });

  it('命中 "没有…只是…"', () => {
    const hits = runDeterministicLint('他没有反驳，只是低头看着桌面。');
    expect(hits.find((h) => h.rule === 'forbidden-meiyou-zhishi')).toBeDefined();
  });

  it('"并非…而是…" 也是 blocker', () => {
    const hits = runDeterministicLint('这并非偶然，而是早有预谋。');
    expect(hits.find((h) => h.rule === 'forbidden-bushi-ershi')).toBeDefined();
  });
});

describe('runDeterministicLint - 弱转折 blocker', () => {
  it('命中 "虽然…但是…"', () => {
    const hits = runDeterministicLint('虽然天色已晚，但是他依然没回家。');
    const hit = hits.find((h) => h.rule === 'forbidden-suiran-danshi');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('blocker');
  });

  it('命中 "尽管…却…"', () => {
    const hits = runDeterministicLint('尽管事先做了准备，他却还是被对方打了个措手不及。');
    expect(hits.find((h) => h.rule === 'forbidden-jinguan-que')).toBeDefined();
  });

  it('命中 "并不…却…"', () => {
    const hits = runDeterministicLint('他并不感到意外，却仍然停下了脚步。');
    expect(hits.find((h) => h.rule === 'forbidden-bingbu-que')).toBeDefined();
  });
});

describe('runDeterministicLint - 连续他/她主语', () => {
  it('连续 3 句他开头 命中 major', () => {
    const text = '他推门进来。他扫视一圈。他坐下倒了杯茶。';
    const hits = runDeterministicLint(text);
    expect(hits.find((h) => h.rule === 'forbidden-tata-chain')).toBeDefined();
  });

  it('混合主语不命中', () => {
    const text = '他推门进来。屋里灯还亮着。她抬头看了一眼。';
    const hits = runDeterministicLint(text).filter((h) => h.rule === 'forbidden-tata-chain');
    expect(hits).toEqual([]);
  });
});

describe('detectDuplicateParagraphs', () => {
  it('两段完全相同 → blocker', () => {
    const text = ['林越推开门走进屋里，桌上还放着昨晚没喝完的茶。', '', '林越推开门走进屋里，桌上还放着昨晚没喝完的茶。'].join('\n');
    const hits = detectDuplicateParagraphs(text);
    expect(hits.length).toBe(1);
    expect(hits[0]!.severity).toBe('blocker');
  });

  it('短段落（< 20 字）忽略', () => {
    const text = ['好的。', '', '好的。'].join('\n');
    expect(detectDuplicateParagraphs(text)).toEqual([]);
  });

  it('段落不同 → 0 命中', () => {
    const text = ['林越推开门走进屋里，桌上还放着昨晚没喝完的茶。', '', '他坐下来，把窗户开了一条缝，让外面的风灌进来。'].join('\n');
    expect(detectDuplicateParagraphs(text)).toEqual([]);
  });
});

describe('summarizeLint', () => {
  it('0 命中 → passed=true', () => {
    const v = summarizeLint([]);
    expect(v.passed).toBe(true);
    expect(v.rewriteHintMd).toBe('');
  });

  it('1 个 blocker → passed=false', () => {
    const v = summarizeLint([
      { rule: 'forbidden-suiran-danshi', severity: 'blocker', match: '虽然...但是', position: 0, fixHint: '禁用弱转折' },
    ]);
    expect(v.passed).toBe(false);
    expect(v.rewriteHintMd).toContain('blocker');
    expect(v.rewriteHintMd).toContain('禁用弱转折');
  });

  it('2 个 major → 不阻塞', () => {
    const v = summarizeLint([
      { rule: 'ai-tic-zhijian', severity: 'major', match: '只见', position: 0, fixHint: 'a' },
      { rule: 'ai-tic-buyou', severity: 'major', match: '不由得', position: 5, fixHint: 'b' },
    ]);
    expect(v.passed).toBe(true);
  });

  it('3 个 major → 阻塞', () => {
    const v = summarizeLint([
      { rule: 'ai-tic-zhijian', severity: 'major', match: '只见', position: 0, fixHint: 'a' },
      { rule: 'ai-tic-buyou', severity: 'major', match: '不由得', position: 5, fixHint: 'b' },
      { rule: 'ai-tic-jiuzaizhe', severity: 'major', match: '就在这时', position: 10, fixHint: 'c' },
    ]);
    expect(v.passed).toBe(false);
  });

  it('全 minor → 不阻塞但记录', () => {
    const v = summarizeLint([
      { rule: 'ai-tic-pianke', severity: 'minor', match: '片刻后', position: 0, fixHint: 'a' },
    ]);
    expect(v.passed).toBe(true);
  });
});

describe('runQualityLint - 集成', () => {
  it('AI 口癖 + 否定对比 + 重复段落都触发', () => {
    const text = [
      '只见他走进屋里，不由得叹了口气，他要的不是这个，而是真相。',
      '',
      '只见他走进屋里，不由得叹了口气，他要的不是这个，而是真相。',
    ].join('\n');
    const v = runQualityLint(text);
    expect(v.passed).toBe(false);
    expect(v.hits.find((h) => h.rule === 'duplicate-paragraph')).toBeDefined();
    expect(v.hits.find((h) => h.rule === 'forbidden-bushi-ershi')).toBeDefined();
  });

  it('干净文本通过', () => {
    const text = '林越推开门，灯光从缝隙里漏出来。屋里没人，桌上一杯凉透的茶散着隔夜的酸味。他坐下来，把窗户开了一条缝。';
    const v = runQualityLint(text);
    expect(v.passed).toBe(true);
    expect(v.rewriteHintMd).toBe('');
  });
});

describe('runChapterQualityGate (deterministic + LLM 双层)', () => {
  let bookId: string;
  let rootRunId: string;

  beforeAll(async () => {
    const [b] = await db
      .insert(books)
      .values({
        title: `__quality-gate-test ${Date.now()}`,
        protagonist: '林越',
        prohibitedTropes: ['上古血脉觉醒', '末世化'],
      })
      .returning();
    bookId = b!.id;
    const [r] = await db
      .insert(runs)
      .values({ kind: 'produce-book', status: 'running', bookId })
      .returning({ id: runs.id });
    rootRunId = r!.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLlmClientForTests();
  });

  const mkOpts = (chapterContentMd: string) => ({
    rootRunId,
    bookId,
    chapterIdx: 2,
    chapterTitle: '试章',
    chapterContentMd,
    protagonist: '林越',
    prohibitedTropes: ['上古血脉觉醒', '末世化'],
    canonicalNumbersMd: '宗门总数：3 个；护身符：1 枚',
    castMd: '林越（主角，POV）；苏婉（盟友）',
    lastHookMd: '林越望着远处灯笼摇曳，握紧腰间剑柄。',
    bookTitle: '测试书',
    audience: '男频',
    mainArcMd: '少年下山闯荡修仙界。',
  });

  const cleanContent =
    '林越推开门，灯光从缝隙里漏了一条出来。屋里只剩残留的茶香，桌上的杯子已经凉透。' +
    '他坐到窗边的木凳上，把窗户开了一道缝，让山风吹散屋里的烟气。' +
    '远处灯笼依旧摇曳，他手指扫过剑柄上的旧刻痕。';

  it('deterministic 层失败时立即 reject 不调用 LLM', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('LLM 不应被调用');
    });
    // "不是...而是..." 触发 deterministic blocker
    const dirty = '林越要的不是宝藏，而是真相。' + cleanContent;
    const r = await runChapterQualityGate(mkOpts(dirty));
    expect(r.passed).toBe(false);
    expect(r.deterministic.passed).toBe(false);
    expect(r.llmReport).toBeUndefined();
    expect(r.rewriteHintMd).toMatch(/否定对比/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deterministic 通过 + LLM passed → 整体 passed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          model: 'fake',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  passed: true,
                  summaryMd: '语义/契约/接续三层无明显问题。',
                  issues: [],
                  rewriteHintMd: '',
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const r = await runChapterQualityGate(mkOpts(cleanContent));
    expect(r.passed).toBe(true);
    expect(r.deterministic.passed).toBe(true);
    expect(r.llmReport?.passed).toBe(true);
    expect(r.rewriteHintMd).toBe('');
  });

  it('deterministic 通过 + LLM failed → 输出 rewriteHintMd', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          model: 'fake',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  passed: false,
                  summaryMd: '本章踩了 1 条题材红线。',
                  issues: [
                    {
                      kind: 'genre-trope-violation',
                      severity: 'blocker',
                      evidenceMd: '本章引入"上古血脉觉醒"，明显属于 prohibited_tropes。',
                      fixMd: '删除上古血脉相关情节，回到主线。',
                    },
                  ],
                  rewriteHintMd: '删除上古血脉觉醒戏份，重写本章后半段，让林越保持普通人身份推进剧情。',
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const r = await runChapterQualityGate(mkOpts(cleanContent));
    expect(r.passed).toBe(false);
    expect(r.deterministic.passed).toBe(true);
    expect(r.llmReport?.passed).toBe(false);
    expect(r.llmReport?.issues[0]?.kind).toBe('genre-trope-violation');
    expect(r.rewriteHintMd).toMatch(/删除上古血脉/);
  });

  it('LLM rewriteHintMd 为空时回退到 issues 拼接', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          model: 'fake',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  passed: false,
                  summaryMd: 'POV 越界 + canonical 数字漂移。',
                  issues: [
                    {
                      kind: 'pov-violation',
                      severity: 'blocker',
                      evidenceMd: '"敌人在屋顶冷笑"——主角在屋内不应能看到。',
                      fixMd: '改为主角听到屋顶动静，不要直接交代敌人表情。',
                    },
                    {
                      kind: 'canonical-number-drift',
                      severity: 'blocker',
                      evidenceMd: '本章写"五个宗门"，canonical-numbers 记载 3 个。',
                      fixMd: '改回 3 个宗门或先在 canonical-numbers 文档里更新。',
                    },
                  ],
                  rewriteHintMd: '',
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const r = await runChapterQualityGate(mkOpts(cleanContent));
    expect(r.passed).toBe(false);
    expect(r.rewriteHintMd).toMatch(/POV 越界/);
    expect(r.rewriteHintMd).toMatch(/pov-violation/);
    expect(r.rewriteHintMd).toMatch(/canonical-number-drift/);
  });
});
