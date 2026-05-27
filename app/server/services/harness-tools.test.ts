import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { bookDocs, bookStates, books, chapters, plotThreads } from '../db/schema/index.ts';
import {
  buildChapterWriterTools,
  commitChapterWriterSession,
  createHarnessSession,
} from './harness-tools.ts';
import { upsertDoc } from './book-docs.ts';

let bookId: string;

beforeAll(async () => {
  const [b] = await db
    .insert(books)
    .values({ title: `__harness-tools-test ${Date.now()}` })
    .returning();
  bookId = b!.id;

  // 初始活文档：一份 character + 一份 design
  await upsertDoc({
    bookId,
    kind: 'character',
    slug: 'lin-chen',
    title: '林辰 · 角色卡',
    contentMd: '# 林辰\n\n身份：少年剑修。',
    editor: 'agent',
  });
  await upsertDoc({
    bookId,
    kind: 'design',
    slug: 'story-concept',
    title: '故事设定（测试）',
    contentMd: '# 故事设定\n\n少年崛起爽文。',
    editor: 'agent',
  });

  // 写入一章测试章节
  await db.insert(chapters).values({
    bookId,
    idx: 1,
    title: '楔子',
    contentMd: '林辰从青云宗下山，遇见黑袍人。',
    charCount: 14,
    status: 'final',
  });
  await db.insert(bookStates).values({
    bookId,
    chapterIdx: 1,
    arcStage: '开端',
    activeCharacters: [{ name: '林辰', status: '在场' }],
    lastEventSummaryMd: '林辰下山遇黑袍。',
    nextChapterIntentMd: '揭露黑袍身份。',
  });
});

afterAll(async () => {
  if (bookId) await db.delete(books).where(eq(books.id, bookId));
});

const tools = buildChapterWriterTools();
const tool = (name: string) => tools.find((t) => t.name === name)!;

describe('harness-tools', () => {
  it('list 顶层返回目录树', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('list').execute({ path: '' } as never, { session });
    expect(r.resultMd).toMatch(/docs\//);
    expect(r.resultMd).toMatch(/chapters\//);
    expect(r.resultMd).toMatch(/threads\//);
  });

  it('list docs 列出已有活文档', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('list').execute({ path: 'docs' } as never, { session });
    expect(r.resultMd).toMatch(/docs\/character\/lin-chen/);
    expect(r.resultMd).toMatch(/docs\/design\/story-concept/);
  });

  it('read docs/character/lin-chen 返回全文', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('read').execute(
      { path: 'docs/character/lin-chen' } as never,
      { session },
    );
    expect(r.resultMd).toMatch(/林辰/);
    expect(r.resultMd).toMatch(/少年剑修/);
  });

  it('read chapters/1 返回章节正文', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('read').execute({ path: 'chapters/1' } as never, { session });
    expect(r.resultMd).toMatch(/楔子/);
    expect(r.resultMd).toMatch(/黑袍/);
  });

  it('read chapters/1/state 返回上一章状态', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('read').execute(
      { path: 'chapters/1/state' } as never,
      { session },
    );
    expect(r.resultMd).toMatch(/arcStage: 开端/);
    expect(r.resultMd).toMatch(/林辰\(在场\)/);
  });

  it('grep 跨文档查找子串命中', async () => {
    const session = createHarnessSession(bookId, 2);
    const r = await tool('grep').execute(
      { pattern: '黑袍', path: '', regex: false, contextLines: 1 } as never,
      { session },
    );
    expect(r.resultMd).toMatch(/chapters\/1/);
  });

  it('update_doc 写到 pending，立刻可读且 list 显示 [pending]', async () => {
    const session = createHarnessSession(bookId, 2);
    const updated = await tool('update_doc').execute(
      {
        path: 'docs/character/lin-chen',
        title: '林辰 · 角色卡',
        content_md: '# 林辰\n\n身份：少年剑修。\n\n## 变化轨迹\n- 第 2 章：拜师黑袍人',
        reason_md: '本章拜师',
      } as never,
      { session },
    );
    expect(updated.resultMd).toMatch(/pending/);

    // read 看得见 pending
    const read = await tool('read').execute(
      { path: 'docs/character/lin-chen' } as never,
      { session },
    );
    expect(read.resultMd).toMatch(/拜师黑袍人/);

    // list 标记 pending
    const list = await tool('list').execute({ path: 'docs/character' } as never, { session });
    expect(list.resultMd).toMatch(/\[pending\]/);

    // 但 DB 里还没改
    const [dbRow] = await db
      .select()
      .from(bookDocs)
      .where(eq(bookDocs.id, (await db.select().from(bookDocs).where(eq(bookDocs.bookId, bookId)).limit(20)).find((d) => d.slug === 'lin-chen')!.id));
    expect(dbRow!.contentMd).not.toMatch(/拜师黑袍人/);
  });

  it('mark_thread 攒到 pending，commit 后落库', async () => {
    const session = createHarnessSession(bookId, 2);
    await tool('mark_thread').execute(
      {
        action: 'introduce',
        title: '黑袍人的真实身份',
        weight: 'arc',
        payoff_window_chapters: 8,
        note_md: '第 2 章引入',
      } as never,
      { session },
    );
    const beforeCount = (
      await db.select().from(plotThreads).where(eq(plotThreads.bookId, bookId))
    ).length;
    expect(beforeCount).toBe(0);

    await commitChapterWriterSession({ session, rootRunId: '00000000-0000-0000-0000-000000000000' });

    const after = await db.select().from(plotThreads).where(eq(plotThreads.bookId, bookId));
    expect(after.length).toBe(1);
    expect(after[0]!.title).toBe('黑袍人的真实身份');
    expect(after[0]!.weight).toBe('arc');
    expect(after[0]!.expectedPayoffEnd).toBe(2 + 8); // introducedAt + window
  });

  it('submit_chapter 标记 isTerminal 且返回 terminalPayload', async () => {
    const session = createHarnessSession(bookId, 2);
    const submit = tool('submit_chapter');
    expect(submit.isTerminal).toBe(true);
    const r = await submit.execute(
      {
        title: '第 2 章 拜师',
        content_md: 'x'.repeat(600),
        hook_md: '夜色将至。',
        new_state: {
          arc_stage: '上升',
          active_characters: [{ name: '林辰', status: '在场' }],
          last_event_summary_md: '拜师',
          next_chapter_intent_md: '出师试炼',
        },
      } as never,
      { session },
    );
    expect(r.terminalPayload).toBeDefined();
    expect((r.terminalPayload as { title: string }).title).toBe('第 2 章 拜师');
  });

  describe('submit_chapter 字数校验', () => {
    const baseArgs = {
      title: '第 2 章',
      hook_md: '夜色将至。',
      new_state: {
        arc_stage: '上升',
        active_characters: [{ name: '林辰', status: '在场' }],
        last_event_summary_md: '...',
        next_chapter_intent_md: '...',
      },
    };

    it('charsPerChapter 给出时，超过 +1000 上限 throw 让 harness 重写', async () => {
      const session = createHarnessSession(bookId, 2);
      const tools3000 = buildChapterWriterTools({ charsPerChapter: 3000 });
      const submit = tools3000.find((t) => t.name === 'submit_chapter')!;
      // 4500 中文字符，目标 3000，上限 4000 → 超
      const tooLong = '光'.repeat(4500);
      await expect(
        submit.execute({ ...baseArgs, content_md: tooLong } as never, { session }),
      ).rejects.toThrow(/字数 4500 超过上限 4000/);
    });

    it('charsPerChapter 给出时，低于 -300 下限 throw 让 harness 补写', async () => {
      const session = createHarnessSession(bookId, 2);
      const tools3000 = buildChapterWriterTools({ charsPerChapter: 3000 });
      const submit = tools3000.find((t) => t.name === 'submit_chapter')!;
      const tooShort = '光'.repeat(2500); // < 2700
      await expect(
        submit.execute({ ...baseArgs, content_md: tooShort } as never, { session }),
      ).rejects.toThrow(/字数 2500 低于下限 2700/);
    });

    it('charsPerChapter 给出时，落在 [-300, +1000] 区间内不报错', async () => {
      const session = createHarnessSession(bookId, 2);
      const tools3000 = buildChapterWriterTools({ charsPerChapter: 3000 });
      const submit = tools3000.find((t) => t.name === 'submit_chapter')!;
      // 边界 case：恰好 +1000 的上限
      const upperBoundary = '光'.repeat(4000);
      const r1 = await submit.execute(
        { ...baseArgs, content_md: upperBoundary } as never,
        { session },
      );
      expect(r1.terminalPayload).toBeDefined();
      // 中段
      const justRight = '光'.repeat(3000);
      const r2 = await submit.execute(
        { ...baseArgs, content_md: justRight } as never,
        { session },
      );
      expect(r2.terminalPayload).toBeDefined();
      // 边界 case：恰好 -300 的下限
      const lowerBoundary = '光'.repeat(2700);
      const r3 = await submit.execute(
        { ...baseArgs, content_md: lowerBoundary } as never,
        { session },
      );
      expect(r3.terminalPayload).toBeDefined();
    });

    it('charsPerChapter 不给时，跳过字数校验（向后兼容）', async () => {
      const session = createHarnessSession(bookId, 2);
      const submit = tool('submit_chapter');
      const r = await submit.execute(
        { ...baseArgs, content_md: '光'.repeat(10000) } as never,
        { session },
      );
      expect(r.terminalPayload).toBeDefined();
    });
  });

  describe('submit_chapter 段落去重保护', () => {
    const baseArgs = {
      title: '测试章',
      hook_md: '夜色将至。',
      new_state: {
        arc_stage: '上升',
        active_characters: [{ name: '林辰', status: '在场' }],
        last_event_summary_md: '...',
        next_chapter_intent_md: '...',
      },
    };

    it('章内字面重复（30 字段连续两次出现）触发 reject', async () => {
      const session = createHarnessSession(bookId, 2);
      const submit = tool('submit_chapter');
      const dupSegment = '林辰握紧剑柄环视四周阴影中传出冰冷叹息他屏住呼吸不敢妄动';
      // dupSegment 长度约 30 字，构造文本：前缀 200 + dup + 中间 200 + 同一 dup + 后缀
      const content =
        '楔子中林辰下山遇见黑袍人路过山脚的青云镇黑袍背影神秘莫测。'.repeat(8) +
        dupSegment +
        '随后他穿过密林林叶遮蔽天光风过处草木轻响他停住脚步细细聆听。'.repeat(6) +
        dupSegment +
        '黑袍人停在崖边一动不动衣袂在山风中翻飞良久才转过身来眼神冰冷。'.repeat(6);
      await expect(
        submit.execute({ ...baseArgs, content_md: content } as never, { session }),
      ).rejects.toThrow(/段落字面重复/);
    });

    it('章内单字填充不会误判（"光光光光"）', async () => {
      const session = createHarnessSession(bookId, 2);
      const submit = tool('submit_chapter');
      const r = await submit.execute(
        { ...baseArgs, content_md: '光'.repeat(800) } as never,
        { session },
      );
      expect(r.terminalPayload).toBeDefined();
    });

    it('与上一章 5-gram 重叠率 > 30% 触发 reject', async () => {
      // seeded ch1 = "林辰从青云宗下山，遇见黑袍人。"（14 字符）
      // 构造本章：每句都不一样（避免章内 dup），但每句都嵌入 ch1 的关键 5-gram，
      // 使得 ch1 上的 5-gram 在本章里命中率极高（> 30%）。
      const session = createHarnessSession(bookId, 2);
      const submit = tool('submit_chapter');
      // 每行用法不重，单字面 30 字内容不重复，但共同贡献 ch1 的 5-gram
      const lines = [
        '林辰从青云宗下山时风疾',
        '青云宗下山林辰心情忐忑',
        '林辰下山遇见黑袍人惊愕',
        '从青云宗下山林辰碰到黑袍',
        '林辰从下山遇见黑袍人后停步',
        '青云宗外林辰望着黑袍人背影',
        '黑袍人现身林辰心头一震',
        '林辰从青云宗下山日遇黑袍',
        '青云宗外林辰下山遇黑袍人手足无措',
        '从青云宗下来的林辰看见黑袍',
        '林辰下山时遇见黑袍走得急',
        '青云宗下山遇见黑袍林辰停下',
        '林辰从青云宗一路下山黑袍人挡前',
        '青云宗下山林辰望见黑袍蹲下',
        '林辰从青云下山黑袍人凝视他',
        '林辰从青云宗下来路遇黑袍人',
        '青云宗下黑袍人朝林辰走来',
        '下山林辰从青云宗碰黑袍人冷哼',
        '林辰下山的青云宗外黑袍人停下',
        '青云宗外林辰从下山遇见黑袍冷笑',
        '林辰从青云宗下山林叶飘散黑袍人浮现',
        '青云宗的林辰下山遇黑袍气氛凝重',
      ];
      const dup = lines.join('。');
      await expect(
        submit.execute({ ...baseArgs, content_md: dup } as never, { session }),
      ).rejects.toThrow(/字面重叠率/);
    });

    it('与上一章重叠率低（全新内容）不触发', async () => {
      const session = createHarnessSession(bookId, 2);
      const submit = tool('submit_chapter');
      // 大段独特句子（不重复、不与 ch1 在 5-gram 层面重叠），≥600 字才能过字数下限校验缺省时也无影响
      const fresh =
        '次日天明集市上响起锣声。小贩抬着担子陆续到位摆摊。' +
        '油纸伞底下早茶铺冒着袅袅热气。马帮老板扯嗓子招呼伙计搬货。' +
        '青石板路面影子被太阳拉得很长。远处城墙轮廓在朝雾里若隐若现。' +
        '少年裹紧外衣绕过石狮往北走去。风从巷口拐进来卷起几片落叶。' +
        '挑夫扛着竹筐喘息停下脚步。茶博士擦着碗角回头招呼客人。' +
        '街角几名商贩低声攀谈着昨夜的怪事。' +
        '鼓楼方向传来悠远钟鸣压过了集市嘈杂。' +
        '蹲在屋檐下的乞儿抬头望了望阴沉天色。' +
        '车辙印从北门一直延伸到城西米仓。' +
        '驴车上拉着几袋粗盐与刚剥的鹿皮。' +
        '账房先生背着油布包翻账本盘货。' +
        '骑差蹄声急促一闪而过尘土飞扬。' +
        '河边几只白鹭被脚步惊起拍打翅膀。' +
        '大栅栏门口杂耍艺人摆开了铁圈。' +
        '观众零零散散有人扔下半个铜板。' +
        '门头小庙的炉灰被风吹散了一地。' +
        '不远处糖葫芦贩子扯着嗓子兜售。' +
        '少年看了看怀里的小布囊继续前行。';
      const r = await submit.execute(
        { ...baseArgs, content_md: fresh } as never,
        { session },
      );
      expect(r.terminalPayload).toBeDefined();
    });
  });
});
