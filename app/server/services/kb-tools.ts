import { z } from 'zod';
import type { ToolDef } from './harness-tools.ts';
import { grepKb, listKb, readKb, type KbSnapshot } from './kb-tree.ts';

/**
 * 复利知识库（elements / classification / hooks / anti-patterns）的虚拟文件树工具集。
 *
 * 抽出来给多个 harness 复用：
 * - brainstorm-harness：立项 chat，决策选题
 * - story-designer-harness：立项后续设计阶段，自由 fanout 活文档
 *
 * 任何持有 `{ kb: KbSnapshot }` 的 session 都能直接用。其他字段不感知。
 */

export interface KbSessionLike {
  kb: KbSnapshot;
}

const ListKbArgs = z.object({
  path: z.string().max(200).optional().default(''),
});

export const listKbTool: ToolDef<z.infer<typeof ListKbArgs>, KbSessionLike> = {
  name: 'list_kb',
  description:
    '列出 KB 虚拟文件树某目录下的"文件 + 子目录"。\n' +
    '路径例：空串 = 顶层 / "elements" / "classification" / "hooks" / "anti-patterns"。\n' +
    '使用时机：你不知道某分类下有哪些条目，先 list 再 read 具体文件。\n' +
    '不要用：路径已知 → 直接 read_kb；按关键词找 → grep_kb。',
  argSchema: ListKbArgs,
  isTerminal: false,
  async execute(args, { session }) {
    return { resultMd: listKb(session.kb, args.path ?? '') };
  },
};

const ReadKbArgs = z.object({
  path: z.string().min(1).max(200),
});

export const readKbTool: ToolDef<z.infer<typeof ReadKbArgs>, KbSessionLike> = {
  name: 'read_kb',
  description:
    '读 KB 中某个文件的全文 markdown（如 /elements/rebirth.md）。\n' +
    '使用时机：路径已知，要看完整内容。\n' +
    '不要用：模糊查找 → grep_kb；浏览目录 → list_kb。',
  argSchema: ReadKbArgs,
  isTerminal: false,
  async execute(args, { session }) {
    return { resultMd: readKb(session.kb, args.path) };
  },
};

const GrepKbArgs = z.object({
  pattern: z.string().min(1).max(200),
  scope: z.string().max(100).optional().default(''),
});

export const grepKbTool: ToolDef<z.infer<typeof GrepKbArgs>, KbSessionLike> = {
  name: 'grep_kb',
  description:
    '在 KB scope 下用 regex 搜匹配行（不区分大小写）。\n' +
    'scope = 顶层目录名（"elements" / "classification" / "hooks" / "anti-patterns"），空串 = 全 KB。\n' +
    '返回每行命中："<path>:<行号>  <匹配行>"，最多 100 条。\n' +
    '使用时机：按关键词/主题找候选元素或 hook，比如找跟"系统流"相关的元素。\n' +
    '不要用：你已经知道路径 → 直接 read_kb。',
  argSchema: GrepKbArgs,
  isTerminal: false,
  async execute(args, { session }) {
    return { resultMd: grepKb(session.kb, args.pattern, args.scope ?? '') };
  },
};

/**
 * 三件套打包导出，按入参顺序拼到 harness tool 列表里。
 * S 必须满足 `KbSessionLike`，TS 类型推导出 `ToolDef<unknown, S>` 的数组形态。
 */
export function buildKbTools<S extends KbSessionLike>(): Array<ToolDef<unknown, S>> {
  return [listKbTool, readKbTool, grepKbTool] as unknown as Array<ToolDef<unknown, S>>;
}
