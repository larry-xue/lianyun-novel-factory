import { describe, expect, it } from 'vitest';
import { parseNovelTxt } from './novel-txt-import.ts';

const SAMPLE_HEADER = [
  '书名：星河彼端',
  '作者：林深时见鹿',
  'book_id=1234567890',
  '状态：连载中',
  '评分：9.2',
  '字数：120万',
  '章节：500',
  '分类：科幻',
  '标签：星际、机甲',
  '在读：300人',
  '简介：这是一段简介，',
  '会跨多行，但都属于简介块。',
  '',
  '================================',
].join('\n');

function buildTxt(chapters: { idx: number; title?: string; body?: string }[]): string {
  const parts = [SAMPLE_HEADER];
  for (const c of chapters) {
    parts.push('');
    parts.push(c.title ?? `第${c.idx}章 第${c.idx}话`);
    parts.push('');
    parts.push(c.body ?? `这是第 ${c.idx} 章的正文内容。`.repeat(2));
  }
  return parts.join('\n');
}

describe('parseNovelTxt', () => {
  it('解析书名、作者、book_id', () => {
    const txt = buildTxt([{ idx: 1 }]);
    const r = parseNovelTxt(txt);
    expect(r.meta.bookTitle).toBe('星河彼端');
    expect(r.meta.author).toBe('林深时见鹿');
    expect(r.meta.bookId).toBe('1234567890');
    expect(r.author).toBe('林深时见鹿');
    expect(r.sourceUrl).toBe('novel://book/1234567890');
    expect(r.tags).toContain('novel-txt');
    expect(r.tags).toContain('book_id:1234567890');
  });

  it('剥掉顶部元信息和分隔线，保留章节标题与正文', () => {
    const txt = buildTxt([{ idx: 1, body: '正文 A' }]);
    const r = parseNovelTxt(txt);
    expect(r.contentMd).not.toContain('书名：');
    expect(r.contentMd).not.toContain('作者：');
    expect(r.contentMd).not.toContain('book_id=');
    expect(r.contentMd).not.toContain('简介：');
    expect(r.contentMd).not.toMatch(/={8,}/);
    expect(r.contentMd).toContain('第1章');
    expect(r.contentMd).toContain('正文 A');
  });

  it('前 10 章 → 标题加 "前 10 章" 后缀，tags 含 "前10章"', () => {
    const chapters = Array.from({ length: 10 }, (_, i) => ({ idx: i + 1 }));
    const txt = buildTxt(chapters);
    const r = parseNovelTxt(txt);
    expect(r.title).toBe('星河彼端 · 前 10 章');
    expect(r.tags).toContain('前10章');
    expect(r.meta.chapterCount).toBe(10);
    expect(r.meta.chapterStart).toBe(1);
    expect(r.meta.chapterEnd).toBe(10);
  });

  it('章节区间不从 1 起 → 标题用 "第 A-B 章"，无 前N章 tag', () => {
    const chapters = [5, 6, 7].map((i) => ({ idx: i }));
    const txt = buildTxt(chapters);
    const r = parseNovelTxt(txt);
    expect(r.title).toBe('星河彼端 · 第 5-7 章');
    expect(r.tags).not.toEqual(expect.arrayContaining([expect.stringMatching(/^前\d+章$/)]));
  });

  it('无元信息 → 用文件名兜底，author 为 未知作者', () => {
    const txt = ['第1章 引子', '', '正文'].join('\n');
    const r = parseNovelTxt(txt, '某本书.txt');
    expect(r.author).toBe('未知作者');
    expect(r.title).toBe('某本书 · 前 1 章');
  });

  it('无章节 → 标题用 fallback，无章节 tag', () => {
    const txt = ['书名：散文集', '作者：某甲', '', '一段没有章节标题的散文。'].join('\n');
    const r = parseNovelTxt(txt);
    expect(r.title).toBe('散文集');
    expect(r.tags).toEqual(['novel-txt']);
    expect(r.meta.chapterCount).toBeUndefined();
  });

  it('支持中文数字章节', () => {
    const txt = ['第一章 起', '内容 A', '', '第二章 承', '内容 B', '', '第十章 转', '内容 C'].join(
      '\n',
    );
    const r = parseNovelTxt(txt, 'x.txt');
    expect(r.meta.chapterStart).toBe(1);
    expect(r.meta.chapterEnd).toBe(10);
    expect(r.meta.chapterCount).toBe(3);
  });

  it('折叠 3 个以上空行为 2 个', () => {
    const txt = ['书名：X', '作者：Y', '', '第1章 引子', '', '', '', '', '正文'].join('\n');
    const r = parseNovelTxt(txt);
    expect(r.contentMd).not.toMatch(/\n{3,}/);
  });

  it('无 book_id → sourceUrl 为 undefined', () => {
    const txt = ['书名：X', '作者：Y', '', '第1章 引', '', '正文'].join('\n');
    const r = parseNovelTxt(txt);
    expect(r.sourceUrl).toBeUndefined();
    expect(r.tags).not.toEqual(expect.arrayContaining([expect.stringMatching(/^book_id:/)]));
  });

  it('剥 UTF-8 BOM 与 \\r\\n', () => {
    const txt = '﻿书名：X\r\n作者：Y\r\n\r\n第1章 引\r\n\r\n正文';
    const r = parseNovelTxt(txt);
    expect(r.meta.bookTitle).toBe('X');
    expect(r.contentMd).toContain('第1章');
    expect(r.contentMd).not.toContain('\r');
  });
});
