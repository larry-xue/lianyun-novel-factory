export interface NovelTxtMeta {
  bookTitle?: string;
  author?: string;
  bookId?: string;
  chapterStart?: number;
  chapterEnd?: number;
  chapterCount?: number;
}

export interface NovelTxtImportResult {
  author: string;
  title: string;
  tags: string[];
  sourceUrl?: string;
  contentMd: string;
  meta: NovelTxtMeta;
}

const META_LABELS = [
  '书名',
  '作者',
  '状态',
  '评分',
  '字数',
  '章节',
  '分类',
  '标签',
  '在读',
];

const SEPARATOR_RE = /^[\s]*[=\-]{8,}[\s]*$/;
const CHAPTER_HEAD_RE =
  /^第\s*([0-9]+|[一二三四五六七八九十百千零〇两]+)\s*[章回节][\s::]?/;
const META_LINE_RE = new RegExp(`^(?:${META_LABELS.join('|')})[：:]\\s*(.*)$`);
const BOOK_ID_RE = /^book_id\s*[=:：]\s*(\d+)\s*$/i;
const INTRO_RE = /^简介[：:]\s*(.*)$/;

export function parseNovelTxt(content: string, filename?: string): NovelTxtImportResult {
  const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');

  const meta: NovelTxtMeta = {};
  let cursor = 0;
  let inIntro = false;

  while (cursor < rawLines.length) {
    const line = rawLines[cursor] ?? '';
    const trimmed = line.trim();

    if (CHAPTER_HEAD_RE.test(trimmed)) break;

    if (trimmed === '') {
      if (inIntro) inIntro = false;
      cursor++;
      continue;
    }

    if (SEPARATOR_RE.test(trimmed)) {
      cursor++;
      continue;
    }

    if (inIntro) {
      cursor++;
      continue;
    }

    const introMatch = trimmed.match(INTRO_RE);
    if (introMatch) {
      inIntro = true;
      cursor++;
      continue;
    }

    const bookIdMatch = trimmed.match(BOOK_ID_RE);
    if (bookIdMatch && bookIdMatch[1]) {
      meta.bookId = bookIdMatch[1];
      cursor++;
      continue;
    }

    const metaMatch = trimmed.match(META_LINE_RE);
    if (metaMatch) {
      const label = trimmed.split(/[：:]/, 1)[0];
      const value = (metaMatch[1] ?? '').trim();
      if (label === '书名') meta.bookTitle = value || undefined;
      else if (label === '作者') meta.author = value || undefined;
      cursor++;
      continue;
    }

    break;
  }

  const bodyLines: string[] = [];
  const chapterNumbers: number[] = [];
  for (let i = cursor; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';
    const trimmed = line.trim();
    if (SEPARATOR_RE.test(trimmed)) continue;
    const m = trimmed.match(CHAPTER_HEAD_RE);
    if (m && m[1]) {
      const n = parseChineseOrArabic(m[1]);
      if (n != null) chapterNumbers.push(n);
    }
    bodyLines.push(line);
  }

  let body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (chapterNumbers.length > 0) {
    meta.chapterStart = chapterNumbers[0];
    meta.chapterEnd = chapterNumbers[chapterNumbers.length - 1];
    meta.chapterCount = chapterNumbers.length;
  }

  const author = meta.author && meta.author.length > 0 ? meta.author : '未知作者';

  const fallbackBook =
    meta.bookTitle ?? stripTxtExt(filename) ?? '未知作品';

  let title = fallbackBook;
  if (
    chapterNumbers.length > 0 &&
    meta.chapterStart === 1 &&
    isStrictlyIncreasingFromOne(chapterNumbers)
  ) {
    title = `${fallbackBook} · 前 ${chapterNumbers.length} 章`;
  } else if (chapterNumbers.length > 0) {
    title = `${fallbackBook} · 第 ${meta.chapterStart}-${meta.chapterEnd} 章`;
  }

  const tags: string[] = ['novel-txt'];
  if (
    chapterNumbers.length > 0 &&
    meta.chapterStart === 1 &&
    isStrictlyIncreasingFromOne(chapterNumbers)
  ) {
    tags.push(`前${chapterNumbers.length}章`);
  }
  if (meta.bookId) tags.push(`book_id:${meta.bookId}`);

  const sourceUrl = meta.bookId ? `novel://book/${meta.bookId}` : undefined;

  return {
    author,
    title,
    tags,
    sourceUrl,
    contentMd: body,
    meta,
  };
}

function stripTxtExt(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.replace(/\.txt$/i, '').trim() || undefined;
}

function isStrictlyIncreasingFromOne(nums: number[]): boolean {
  if (nums.length === 0 || nums[0] !== 1) return false;
  for (let i = 1; i < nums.length; i++) {
    const cur = nums[i];
    const prev = nums[i - 1];
    if (cur === undefined || prev === undefined || cur !== prev + 1) return false;
  }
  return true;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseOrArabic(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  return parseChineseNumber(s);
}

function parseChineseNumber(s: string): number | null {
  if (!s) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch] ?? 0;
    } else if (ch === '十') {
      section += current === 0 ? 10 : current * 10;
      current = 0;
    } else if (ch === '百') {
      section += (current === 0 ? 1 : current) * 100;
      current = 0;
    } else if (ch === '千') {
      section += (current === 0 ? 1 : current) * 1000;
      current = 0;
    } else {
      return null;
    }
  }
  total += section + current;
  return total > 0 ? total : null;
}
