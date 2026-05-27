import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  antiPatterns,
  elements as elementsTbl,
  hooks,
} from '../db/schema/index.ts';
import {
  CHARACTER_TYPES,
  MAIN_CATEGORIES,
  MAIN_CATEGORY_DESCRIPTIONS,
  PLOT_ELEMENTS,
  THEMES,
} from '../db/schema/classification.ts';

/**
 * brainstorm-harness 把"复利知识库"包装成虚拟文件树给 agent 用。
 *
 *   /elements/<slug>.md        元素词典每条一份
 *   /classification/main.md    主分类清单 + 描述
 *   /classification/themes.md  主题清单
 *   /classification/character.md
 *   /classification/plot.md
 *   /hooks/<slug>.md           Hook 模板
 *   /anti-patterns/<id>.md     反例库
 *
 * 全部内存级（所有库加起来 < 1 MB），每个 invocation 预加载一次给
 * list_kb / read_kb / grep_kb 三个工具用。zero index dependency，
 * 加新表只需要加一段 loader。
 */

export interface KbFile {
  /** 绝对路径，以 / 开头，如 /elements/rebirth.md */
  path: string;
  /** markdown 全文 */
  contentMd: string;
}

export interface KbSnapshot {
  files: KbFile[];
  /** path → file 索引，read_kb O(1) 查 */
  byPath: Map<string, KbFile>;
}

/**
 * 加载所有 KB 内容到内存。每次 brainstorm-harness invocation 调一次。
 * elements/hooks/anti-patterns 都从 db 拉；classification 从 schema
 * 常量直接生成（本来就是源码常量）。
 */
export async function loadKbSnapshot(): Promise<KbSnapshot> {
  const files: KbFile[] = [];

  // /elements/
  const elemRows = await db
    .select()
    .from(elementsTbl)
    .orderBy(asc(elementsTbl.slug));
  for (const e of elemRows) {
    const lines = [
      `# ${e.zh}（${e.slug}）`,
      ``,
      `**category**: ${e.category}`,
      `**hot_score**: ${e.hotScore.toFixed(2)}`,
      ``,
      `## 定义`,
      e.definitionMd || '（暂无）',
    ];
    if (e.comboFriendly.length) {
      lines.push('', `## 兼容元素`, e.comboFriendly.map((s) => `- ${s}`).join('\n'));
    }
    if (e.comboAvoid.length) {
      lines.push('', `## 冲突元素`, e.comboAvoid.map((s) => `- ${s}`).join('\n'));
    }
    files.push({ path: `/elements/${e.slug}.md`, contentMd: lines.join('\n') });
  }

  // /classification/main.md  +  themes / character / plot
  files.push({
    path: `/classification/main.md`,
    contentMd: [
      `# 主分类（单选）`,
      ``,
      ...MAIN_CATEGORIES.map(
        (c) => `- **${c}**：${MAIN_CATEGORY_DESCRIPTIONS[c] ?? ''}`,
      ),
    ].join('\n'),
  });
  files.push({
    path: `/classification/themes.md`,
    contentMd: [`# 主题（最多两个）`, ``, ...THEMES.map((t) => `- ${t}`)].join('\n'),
  });
  files.push({
    path: `/classification/character.md`,
    contentMd: [
      `# 角色类型（最多两个）`,
      ``,
      ...CHARACTER_TYPES.map((t) => `- ${t}`),
    ].join('\n'),
  });
  files.push({
    path: `/classification/plot.md`,
    contentMd: [
      `# 情节元素（最多两个）`,
      ``,
      ...PLOT_ELEMENTS.map((t) => `- ${t}`),
    ].join('\n'),
  });

  // /hooks/
  const hookRows = await db
    .select()
    .from(hooks)
    .orderBy(asc(hooks.kind), asc(hooks.name));
  for (const h of hookRows) {
    const slug = slugifyForPath(h.name);
    files.push({
      path: `/hooks/${slug}.md`,
      contentMd: [
        `# ${h.name}`,
        ``,
        `**kind**: ${h.kind}`,
        h.scenarios.length ? `**scenarios**: ${h.scenarios.join(' · ')}` : '',
        ``,
        h.templateMd,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  }

  // /anti-patterns/
  const apRows = await db
    .select()
    .from(antiPatterns)
    .orderBy(asc(antiPatterns.kind));
  let i = 0;
  for (const a of apRows) {
    i++;
    const fname = `${a.kind || 'misc'}-${String(i).padStart(3, '0')}`;
    files.push({
      path: `/anti-patterns/${slugifyForPath(fname)}.md`,
      contentMd: [`# 反例 / ${a.kind}`, ``, a.contentMd].join('\n'),
    });
  }

  const byPath = new Map<string, KbFile>();
  for (const f of files) byPath.set(f.path, f);

  return { files, byPath };
}

/**
 * ls：列指定目录下的"文件 + 子目录"。
 * path 不带前导 /、不带末尾 / 都接受；空串列顶层。
 */
export function listKb(snap: KbSnapshot, rawPath: string): string {
  const path = normalizeDir(rawPath);
  if (path === '') {
    // 顶层只有几个固定目录
    const tops = new Set<string>();
    for (const f of snap.files) {
      const m = f.path.match(/^\/([^/]+)\//);
      if (m?.[1]) tops.add(m[1]);
    }
    if (tops.size === 0) return '（KB 为空）';
    return [...tops]
      .sort()
      .map((d) => `${d}/`)
      .join('\n');
  }
  const prefix = `/${path}/`;
  const directChildren = new Map<string, 'file' | 'dir'>();
  for (const f of snap.files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash < 0) {
      directChildren.set(rest, 'file');
    } else {
      const dir = rest.slice(0, slash);
      if (!directChildren.has(dir)) directChildren.set(dir, 'dir');
    }
  }
  if (directChildren.size === 0) return `（${path}/ 不存在或为空）`;
  return [...directChildren.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, type]) => (type === 'dir' ? `${name}/` : name))
    .join('\n');
}

/** cat：读单个 path（带 / 不带前导 / 都接受） */
export function readKb(snap: KbSnapshot, rawPath: string): string {
  const path = normalizeFilePath(rawPath);
  const f = snap.byPath.get(path);
  if (!f) return `（路径不存在：${path}）`;
  return f.contentMd;
}

/**
 * grep：按 regex 在 scope 下的所有文件搜索。
 * scope 形如 "elements" / "classification" / "" (全 KB)。
 * 输出每行命中：`<path>:<line>  <匹配行>` 截断到 200 char。最多 100 行。
 */
export function grepKb(
  snap: KbSnapshot,
  pattern: string,
  rawScope: string = '',
): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch (e) {
    return `（regex 非法：${e instanceof Error ? e.message : e}）`;
  }
  const scope = normalizeDir(rawScope);
  const scopePrefix = scope ? `/${scope}/` : '/';

  const hits: string[] = [];
  for (const f of snap.files) {
    if (!f.path.startsWith(scopePrefix)) continue;
    const lines = f.contentMd.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (re.test(line)) {
        hits.push(`${f.path}:${i + 1}  ${line.trim().slice(0, 200)}`);
        if (hits.length >= 100) break;
      }
    }
    if (hits.length >= 100) break;
  }
  if (hits.length === 0) return `（无匹配 · pattern=${pattern} scope=${scope || 'all'}）`;
  return hits.join('\n');
}

/** 标准化目录路径：去掉前后 /，空串表示顶层 */
function normalizeDir(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 标准化文件路径：保证前导 / 但不末尾 / */
function normalizeFilePath(p: string): string {
  let s = p.startsWith('/') ? p : `/${p}`;
  s = s.replace(/\/+$/, '');
  return s;
}

/**
 * 把任意字符串转成 [a-z0-9_-] 路径段。中文 hash 化。
 * 反例库的文件名 / hook 名可能带空格或中文，生成稳定 slug。
 */
function slugifyForPath(s: string): string {
  const ascii = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii) return ascii.slice(0, 60);
  // 全是非 ascii，用简单哈希做 slug
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `x-${(h >>> 0).toString(36)}`;
}
