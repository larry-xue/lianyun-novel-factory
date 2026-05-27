import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildStructuredJsonMessages, safeJsonParse } from './run-tracer.ts';

describe('buildStructuredJsonMessages', () => {
  it('adds agent instructions and an explicit JSON schema contract', async () => {
    const schema = z.object({
      proposals: z.array(
        z.object({
          title: z.string(),
          hook: z.string(),
          scoreOverall: z.number().min(0).max(1),
        }),
      ),
    });

    const messages = await buildStructuredJsonMessages(
      {
        id: 'topic-scout',
        getInstructions: () => '严格 JSON 输出，不要 markdown code fence。',
      },
      '生成 3 个选题。',
      schema,
    );

    const system = messages[0];
    const user = messages[1];

    expect(system).toEqual({
      role: 'system',
      content: '严格 JSON 输出，不要 markdown code fence。',
    });
    expect(user).toBeDefined();
    expect(user!.role).toBe('user');
    expect(user!.content).toContain('只返回一个 JSON object');
    expect(user!.content).toContain('"proposals"');
    expect(user!.content).toContain('"hook"');
    expect(user!.content).toContain('"scoreOverall"');
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON directly', () => {
    expect(safeJsonParse('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });

  it('strips ```json ... ``` fences', () => {
    expect(safeJsonParse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(safeJsonParse('prefix\n```\n{"a":2}\n```\nsuffix')).toEqual({ a: 2 });
  });

  it('recovers from trailing garbage via balanced-brace scan', () => {
    // mimo 这类模型偶发末尾多吐 } —— 括号平衡找到首个匹配 } 后 parse
    const malformed = '{"thought":"x","tool":"read","args":{"path":"docs"}}}';
    expect(safeJsonParse(malformed)).toEqual({
      thought: 'x',
      tool: 'read',
      args: { path: 'docs' },
    });
  });

  it('returns undefined on empty or unrecoverable input', () => {
    expect(safeJsonParse('')).toBeUndefined();
    expect(safeJsonParse(undefined)).toBeUndefined();
    expect(safeJsonParse('not json at all')).toBeUndefined();
    // 内嵌未转义引号 —— 无法启发式修复，应返回 undefined
    expect(safeJsonParse('{"x":"a"b"c"}')).toBeUndefined();
  });

  it('handles strings containing braces correctly (does not split inside string)', () => {
    expect(safeJsonParse('{"x":"hello } world"}')).toEqual({ x: 'hello } world' });
    expect(safeJsonParse('{"x":"a \\"quoted\\" b"}')).toEqual({ x: 'a "quoted" b' });
  });
});
