import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { llmCalls, runs, toolCalls } from '../db/schema/index.ts';
import { ensureLlmConfigReady, getLlmClient, type ChatMessage } from '../llm/client.ts';
import { withRetry } from './_retry.ts';
import {
  CancelledError,
  getCurrentSignal,
  isAbortLikeError,
  throwIfCancelled,
} from './cancellation.ts';
import type { ToolDef } from './harness-tools.ts';

interface MastraLikeAgent {
  id: string;
  getInstructions?: () => Promise<unknown> | unknown;
  generate: (
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    options?: unknown,
  ) => Promise<unknown>;
}

interface MastraResultShape {
  object?: unknown;
  text?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface ChildRunOptions<T> {
  kind: string;
  parentRunId?: string;
  bookId?: string;
  input: Record<string, unknown>;
  agent: MastraLikeAgent;
  prompt: string;
  schema: z.ZodType<T>;
  modelLabel?: string;
  maxTokens?: number;
  /** 默认 3 次重试（共最多 4 次调用）。0 = 关闭重试。 */
  maxRetries?: number;
}

/**
 * 把一次 agent.generate() 包成一棵 run 树上的子节点。
 * - 写一行 runs（status running → success/failure）
 * - 写一行 llm_calls 关联到 run
 * - 校验输出 schema
 *
 * 这样 /runs/$id 才能拿到完整 trace。
 */
export async function runChildAgent<T>(opts: ChildRunOptions<T>): Promise<{
  runId: string;
  result: T;
}> {
  const startedAt = new Date();
  const [child] = await db
    .insert(runs)
    .values({
      kind: opts.kind,
      status: 'running',
      parentId: opts.parentRunId,
      bookId: opts.bookId,
      input: opts.input,
      startedAt,
      model: opts.modelLabel,
    })
    .returning();
  if (!child) throw new Error(`failed to insert child run for ${opts.kind}`);

  const maxRetries = opts.maxRetries ?? 3;
  let attemptsMade = 0;
  const cancelSignal = getCurrentSignal();

  try {
    throwIfCancelled();
    // 不用 mastra 的 structuredOutput：很多 OpenAI 兼容代理（如 mimo）不支持
    // response_format json_schema，Mastra 在内部校验时直接抛 STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED。
    // 改为直接走 OpenAI chat/completions JSON mode：mimo 要求 response_format=json_object。
    const { parsed, promptTokens, completionTokens } = await withRetry(
      async (attemptIdx) => {
        attemptsMade = attemptIdx + 1;
        throwIfCancelled();
        const t0 = Date.now();
        let attemptFailureRecorded = false;
        try {
          await ensureLlmConfigReady();
      const client = getLlmClient();
          const messages = await buildStructuredJsonMessages(
            opts.agent,
            opts.prompt,
            opts.schema,
          );
          const chat = await client.chat({
            messages,
            responseFormat: 'json_object',
            maxTokens: opts.maxTokens,
            signal: cancelSignal,
          });
          const raw: MastraResultShape = {
            text: chat.content,
            usage: {
              promptTokens: chat.promptTokens,
              completionTokens: chat.completionTokens,
              totalTokens: chat.promptTokens + chat.completionTokens,
            },
          };
          const obj = safeJsonParse(raw.text);
          if (obj === undefined) {
            const truncated = chat.finishReason === 'length';
            const errorMd = truncated
              ? `parse failed: response truncated (finish_reason=length, maxTokens=${opts.maxTokens ?? 'unlimited'})`
              : 'parse failed: empty/non-JSON response';
            await db.insert(llmCalls).values({
              runId: child.id,
              model: opts.modelLabel ?? chat.model,
              prompt: {
                messages,
                agent: opts.agent.id,
                responseFormat: 'json_object',
                attempt: attemptIdx + 1,
              },
              response: typeof raw.text === 'string' ? raw.text : null,
              latencyMs: Date.now() - t0,
              errorMd,
            });
            attemptFailureRecorded = true;
            throw new Error(
              truncated
                ? `agent ${opts.agent.id} 响应被截断（finish_reason=length, maxTokens=${opts.maxTokens ?? 'unlimited'}）。尾部：${(raw.text ?? '').slice(-200)}`
                : `agent ${opts.agent.id} 返回空响应（text=${(raw.text ?? '').slice(0, 200)}）`,
            );
          }
          let parsedAttempt: T;
          try {
            parsedAttempt = opts.schema.parse(obj);
          } catch (zerr) {
            await db.insert(llmCalls).values({
              runId: child.id,
              model: opts.modelLabel ?? chat.model,
              prompt: {
                messages,
                agent: opts.agent.id,
                responseFormat: 'json_object',
                attempt: attemptIdx + 1,
              },
              response: typeof raw.text === 'string' ? raw.text : null,
              responseJson: obj as unknown,
              latencyMs: Date.now() - t0,
              errorMd: `schema validation failed: ${zerr instanceof Error ? zerr.message.slice(0, 800) : String(zerr).slice(0, 800)}`,
            });
            attemptFailureRecorded = true;
            throw zerr;
          }
          const promptTokens = raw.usage?.promptTokens ?? raw.usage?.inputTokens ?? 0;
          const completionTokens =
            raw.usage?.completionTokens ?? raw.usage?.outputTokens ?? 0;
          await db.insert(llmCalls).values({
            runId: child.id,
            model: opts.modelLabel ?? chat.model,
            prompt: {
              messages,
              agent: opts.agent.id,
              responseFormat: 'json_object',
              attempt: attemptIdx + 1,
            },
            response: typeof raw.text === 'string' ? raw.text : null,
            responseJson: parsedAttempt as unknown,
            promptTokens,
            completionTokens,
            latencyMs: Date.now() - t0,
          });
          return { parsed: parsedAttempt, promptTokens, completionTokens };
        } catch (err) {
          if (!attemptFailureRecorded) {
            await db.insert(llmCalls).values({
              runId: child.id,
              model: opts.modelLabel ?? 'unknown',
              prompt: {
                messages: [{ role: 'user', content: opts.prompt }],
                agent: opts.agent.id,
                attempt: attemptIdx + 1,
              },
              latencyMs: Date.now() - t0,
              errorMd: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        }
      },
      { maxRetries },
    );

    await db
      .update(runs)
      .set({
        status: 'success',
        finishedAt: new Date(),
        output: parsed as Record<string, unknown>,
        promptTokens,
        completionTokens,
      })
      .where(eq(runs.id, child.id));

    return { runId: child.id, result: parsed };
  } catch (err) {
    const cancelled = isAbortLikeError(err) || cancelSignal?.aborted === true;
    const message = err instanceof Error ? err.message : String(err);
    const finalMsg = attemptsMade > 1 ? `${message} (经过 ${attemptsMade} 次尝试均失败)` : message;
    await db
      .update(runs)
      .set({
        status: cancelled ? 'cancelled' : 'failure',
        finishedAt: new Date(),
        errorMd: cancelled ? '用户中断' : finalMsg,
      })
      .where(eq(runs.id, child.id));
    if (cancelled && !(err instanceof CancelledError)) {
      // 把底层 AbortError 翻译成 CancelledError，方便上游 catch 一致判定
      throw new CancelledError('', message);
    }
    throw err;
  }
}

export async function buildStructuredJsonMessages<T>(
  agent: Pick<MastraLikeAgent, 'id' | 'getInstructions'>,
  prompt: string,
  schema: z.ZodType<T>,
): Promise<ChatMessage[]> {
  const system = normalizeInstructions(
    typeof agent.getInstructions === 'function' ? await agent.getInstructions() : undefined,
  );
  return [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    {
      role: 'user' as const,
      content: [
        prompt,
        '',
        '## 输出格式要求',
        '只返回一个 JSON object。不要返回数组、markdown、代码块、解释文字或多余字段。',
        '字段名必须严格匹配下面 JSON Schema。缺省字段也要按 schema 补齐，不能把 null 用在 string 字段上。',
        JSON.stringify(toPromptJsonSchema(schema), null, 2),
      ].join('\n'),
    },
  ];
}

function normalizeInstructions(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(normalizeInstructions).filter(Boolean).join('\n\n');
  }
  if (typeof value === 'object' && 'content' in value) {
    const content = (value as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(normalizeInstructions).filter(Boolean).join('\n\n');
  }
  return String(value);
}

function toPromptJsonSchema(schema: z.ZodType<unknown>): unknown {
  try {
    return z.toJSONSchema(schema, {
      target: 'draft-7',
      io: 'output',
      unrepresentable: 'any',
    });
  } catch {
    return { type: 'object', description: 'Return an object matching the runtime Zod schema.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Harness 模式：tool-use loop（chapter-writer 等需要多轮探索的场景）
// ─────────────────────────────────────────────────────────────────────────

export interface HarnessToolContext<S = unknown> {
  session: S;
}

export interface HarnessRunOptions<S = unknown> {
  kind: string;
  parentRunId?: string;
  bookId?: string;
  input: Record<string, unknown>;
  /** Agent 的 system 角色文本（不含工具目录，runHarnessedAgent 自动追加） */
  systemPrompt: string;
  /** 首条 user 消息（任务说明、上下文目录树等） */
  userPrompt: string;
  tools: Array<ToolDef<unknown, S>>;
  /**
   * 哪些工具调用后退出循环。任一命中即终止；都必须 isTerminal=true。
   * brainstorm-harness 走多个（ask_user 软终止 / confirm_topic 硬终止），
   * chapter-writer-harness 走一个（submit_chapter）。
   */
  terminalToolNames: string[];
  /** 工具执行上下文（共享 session：pending docs / thread actions） */
  toolContext: HarnessToolContext<S>;
  /** 默认 30。超出抛错。 */
  maxToolCalls?: number;
  /** 单 turn 的 maxTokens（提交章节那 turn 可能很长） */
  maxTokens?: number;
  modelLabel?: string;
  /** 单次 LLM 调用层面的重试次数（不影响 tool 调用循环），默认 2。 */
  maxRetriesPerTurn?: number;
}

export interface HarnessRunResult<T> {
  runId: string;
  result: T;
  toolCallCount: number;
  turns: number;
  /** 命中的终止工具名（多终止 harness 用来分流后续逻辑） */
  terminalTool: string;
}

const HARNESS_PROTOCOL = `## 工具调用协议（必须严格遵守）

每一轮，你必须输出一个 JSON 对象，**不要** markdown 代码块、解释文字、多个 JSON。结构：

{
  "thought": "本轮在做什么、为什么（30-200 字）",
  "tool": "工具名（必须是下面工具列表中的某个）",
  "args": { ...该工具的参数 }
}

每轮只调一个工具。系统会执行后把结果作为下一条 user 消息喂回给你。
继续探索 → 继续输出新的 JSON。
要交付最终成果时 → 把 tool 设为 **终止工具**（见说明），系统据此退出循环。

不要"自言自语"或"假装调用过工具"，每个 JSON 一定会被执行。
不要忘记输出 thought（让人能追溯你的决策）。`;

function buildHarnessSystemPrompt(opts: {
  agentSystem: string;
  tools: Array<ToolDef<unknown, unknown>>;
  terminalToolNames: string[];
}): string {
  const terminalSet = new Set(opts.terminalToolNames);
  const toolsDoc = opts.tools
    .map((t) => {
      const argsHint = describeZodForPrompt(t.argSchema);
      return `### ${t.name}${terminalSet.has(t.name) ? ' [终止工具]' : ''}
${t.description}
args 形状：\`\`\`json
${argsHint}
\`\`\``;
    })
    .join('\n\n');
  const terminalRule =
    opts.terminalToolNames.length === 1
      ? `必须、且只能通过调用 \`${opts.terminalToolNames[0]}\` 终止本次任务。其他任何输出都会被当作中间步继续循环。`
      : `本任务有多个终止工具：${opts.terminalToolNames.map((n) => `\`${n}\``).join(' / ')}。调任一个即退出循环。`;
  return [
    opts.agentSystem,
    '',
    '---',
    '',
    HARNESS_PROTOCOL,
    '',
    `## 可用工具`,
    toolsDoc,
    '',
    `## 终止规则`,
    terminalRule,
  ].join('\n');
}

function describeZodForPrompt(schema: z.ZodType<unknown>): string {
  try {
    const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' });
    return JSON.stringify(json, null, 2);
  } catch {
    return '{}';
  }
}

const HarnessTurnSchema = z.object({
  thought: z.string().optional().default(''),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional().default({}),
});

interface ParsedTurn {
  thought: string;
  tool: string;
  args: Record<string, unknown>;
  rawText: string;
}

interface TurnRecord {
  llmCallId: string;
  toolCallId?: string;
}

/**
 * 多轮 tool-use 循环：每个 model turn 写一行 llm_calls，每个工具调用写一行 tool_calls。
 * 直到 model 调用 terminalToolName 才退出并返回该工具的 terminalPayload。
 */
export async function runHarnessedAgent<T, S = unknown>(
  opts: HarnessRunOptions<S>,
): Promise<HarnessRunResult<T>> {
  const startedAt = new Date();
  const [child] = await db
    .insert(runs)
    .values({
      kind: opts.kind,
      status: 'running',
      parentId: opts.parentRunId,
      bookId: opts.bookId,
      input: opts.input,
      startedAt,
      model: opts.modelLabel,
    })
    .returning();
  if (!child) throw new Error(`failed to insert child run for ${opts.kind}`);

  if (opts.terminalToolNames.length === 0) {
    throw new Error('runHarnessedAgent: terminalToolNames 不能为空');
  }
  const terminalSet = new Set(opts.terminalToolNames);
  for (const name of opts.terminalToolNames) {
    const t = opts.tools.find((x) => x.name === name);
    if (!t) throw new Error(`terminal tool ${name} not in tools list`);
    if (!t.isTerminal) {
      throw new Error(`tool ${name} listed as terminal but isTerminal=false`);
    }
  }

  const maxToolCalls = opts.maxToolCalls ?? 30;
  // 5 次重试（共 6 次尝试）：deepseek-v4-pro 在 20 章 smoke 里偶发连续 3
  // 次空响应，2 次重试不够。指数退避 base=500ms 总等约 12s，能跨过 endpoint
  // 短暂抽风窗口。
  const maxRetriesPerTurn = opts.maxRetriesPerTurn ?? 5;
  const toolByName = new Map(opts.tools.map((t) => [t.name, t]));

  const systemMsg = buildHarnessSystemPrompt({
    agentSystem: opts.systemPrompt,
    tools: opts.tools,
    terminalToolNames: opts.terminalToolNames,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMsg },
    { role: 'user', content: opts.userPrompt },
  ];

  let toolCallCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  const turnRecords: TurnRecord[] = [];
  const cancelSignal = getCurrentSignal();

  try {
    while (true) {
      throwIfCancelled();
      if (toolCallCount >= maxToolCalls) {
        throw new Error(
          `harness exceeded maxToolCalls=${maxToolCalls}（agent 没在预算内调用任一终止工具：${opts.terminalToolNames.join(' / ')}）`,
        );
      }

      // 一次 model turn（含轻量重试：仅协议解析失败时重试）
      const { parsed, llmCallId, promptTokens, completionTokens } = await callOneTurn({
        runId: child.id,
        modelLabel: opts.modelLabel,
        messages,
        maxTokens: opts.maxTokens,
        maxRetries: maxRetriesPerTurn,
        signal: cancelSignal,
      });
      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;

      const tool = toolByName.get(parsed.tool);
      if (!tool) {
        // 协议合法但工具名错 → 反馈给模型继续，不算失败
        const errMd = `ERR: 未知工具 "${parsed.tool}"。可用：${[...toolByName.keys()].join(', ')}`;
        await recordToolCall({
          runId: child.id,
          parentLlmCallId: llmCallId,
          seq: toolCallCount + 1,
          toolName: parsed.tool,
          args: parsed.args,
          resultMd: errMd,
          errorMd: errMd,
          durationMs: 0,
        });
        messages.push({ role: 'assistant', content: parsed.rawText });
        messages.push({ role: 'user', content: `[tool result] ${errMd}` });
        toolCallCount++;
        turnRecords.push({ llmCallId });
        continue;
      }

      // 校验 args
      let parsedArgs: unknown;
      try {
        parsedArgs = tool.argSchema.parse(parsed.args);
      } catch (zerr) {
        const errMd = `ERR: 工具 ${tool.name} 参数校验失败：${zerr instanceof Error ? zerr.message.slice(0, 600) : String(zerr).slice(0, 600)}`;
        await recordToolCall({
          runId: child.id,
          parentLlmCallId: llmCallId,
          seq: toolCallCount + 1,
          toolName: tool.name,
          args: parsed.args,
          resultMd: errMd,
          errorMd: errMd,
          durationMs: 0,
        });
        messages.push({ role: 'assistant', content: parsed.rawText });
        messages.push({ role: 'user', content: `[tool result] ${errMd}` });
        toolCallCount++;
        turnRecords.push({ llmCallId });
        continue;
      }

      // 执行
      const t0 = Date.now();
      let execResult: { resultMd: string; terminalPayload?: unknown };
      let execErr: string | null = null;
      try {
        execResult = await tool.execute(parsedArgs as never, opts.toolContext as never);
      } catch (e) {
        execErr = e instanceof Error ? e.message : String(e);
        execResult = { resultMd: `ERR: ${execErr}` };
      }
      const durationMs = Date.now() - t0;

      const toolCallId = await recordToolCall({
        runId: child.id,
        parentLlmCallId: llmCallId,
        seq: toolCallCount + 1,
        toolName: tool.name,
        args: parsedArgs as Record<string, unknown>,
        resultMd: execResult.resultMd,
        errorMd: execErr,
        durationMs,
      });
      toolCallCount++;
      turnRecords.push({ llmCallId, toolCallId });

      if (tool.isTerminal && terminalSet.has(tool.name) && !execErr) {
        await db
          .update(runs)
          .set({
            status: 'success',
            finishedAt: new Date(),
            output: {
              toolCallCount,
              turns: turnRecords.length,
              terminalTool: tool.name,
              terminalPayload: execResult.terminalPayload as Record<string, unknown>,
            },
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
          })
          .where(eq(runs.id, child.id));
        return {
          runId: child.id,
          result: execResult.terminalPayload as T,
          toolCallCount,
          turns: turnRecords.length,
          terminalTool: tool.name,
        };
      }

      // 非终止 → 把结果喂回，下轮继续
      messages.push({ role: 'assistant', content: parsed.rawText });
      messages.push({
        role: 'user',
        content: `[tool result · ${tool.name}]\n${truncate(execResult.resultMd, 8000)}`,
      });
    }
  } catch (err) {
    const cancelled = isAbortLikeError(err) || cancelSignal?.aborted === true;
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({
        status: cancelled ? 'cancelled' : 'failure',
        finishedAt: new Date(),
        errorMd: cancelled ? '用户中断' : message,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      })
      .where(eq(runs.id, child.id));
    if (cancelled && !(err instanceof CancelledError)) {
      throw new CancelledError('', message);
    }
    throw err;
  }
}

interface OneTurnResult {
  parsed: ParsedTurn;
  llmCallId: string;
  promptTokens: number;
  completionTokens: number;
}

async function callOneTurn(opts: {
  runId: string;
  modelLabel?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  maxRetries: number;
  signal?: AbortSignal;
}): Promise<OneTurnResult> {
  return await withRetry(
    async (attemptIdx) => {
      throwIfCancelled();
      const t0 = Date.now();
      await ensureLlmConfigReady();
      const client = getLlmClient();
      const chat = await client.chat({
        messages: opts.messages,
        responseFormat: 'json_object',
        maxTokens: opts.maxTokens,
        signal: opts.signal,
      });

      const text = chat.content ?? '';
      const obj = safeJsonParse(text);
      if (obj === undefined) {
        const errorMd =
          chat.finishReason === 'length'
            ? `parse failed: response truncated (finish_reason=length, maxTokens=${opts.maxTokens ?? 'unlimited'})`
            : 'parse failed: empty/non-JSON response';
        await db.insert(llmCalls).values({
          runId: opts.runId,
          model: opts.modelLabel ?? chat.model,
          prompt: { messages: opts.messages, mode: 'harness', attempt: attemptIdx + 1 },
          response: text,
          latencyMs: Date.now() - t0,
          errorMd,
        });
        throw new Error(`harness turn ${chat.finishReason === 'length' ? '响应被截断' : '返回空/非 JSON'}：${text.slice(0, 200)}`);
      }

      let parsed: ParsedTurn;
      try {
        const t = HarnessTurnSchema.parse(obj);
        parsed = { thought: t.thought, tool: t.tool, args: t.args, rawText: text };
      } catch (zerr) {
        await db.insert(llmCalls).values({
          runId: opts.runId,
          model: opts.modelLabel ?? chat.model,
          prompt: { messages: opts.messages, mode: 'harness', attempt: attemptIdx + 1 },
          response: text,
          responseJson: obj as unknown,
          latencyMs: Date.now() - t0,
          errorMd: `harness turn schema 校验失败：${zerr instanceof Error ? zerr.message.slice(0, 600) : String(zerr).slice(0, 600)}`,
        });
        throw zerr;
      }

      const promptTokens = chat.promptTokens ?? 0;
      const completionTokens = chat.completionTokens ?? 0;
      const [row] = await db
        .insert(llmCalls)
        .values({
          runId: opts.runId,
          model: opts.modelLabel ?? chat.model,
          prompt: { messages: opts.messages, mode: 'harness', attempt: attemptIdx + 1 },
          response: text,
          responseJson: parsed as unknown,
          promptTokens,
          completionTokens,
          latencyMs: Date.now() - t0,
        })
        .returning({ id: llmCalls.id });
      return { parsed, llmCallId: row!.id, promptTokens, completionTokens };
    },
    { maxRetries: opts.maxRetries },
  );
}

async function recordToolCall(opts: {
  runId: string;
  parentLlmCallId?: string;
  seq: number;
  toolName: string;
  args: Record<string, unknown>;
  resultMd: string;
  errorMd?: string | null;
  durationMs: number;
}): Promise<string> {
  const [row] = await db
    .insert(toolCalls)
    .values({
      runId: opts.runId,
      parentLlmCallId: opts.parentLlmCallId,
      seq: opts.seq,
      toolName: opts.toolName,
      argsJson: opts.args,
      resultMd: opts.resultMd,
      errorMd: opts.errorMd ?? null,
      durationMs: opts.durationMs,
    })
    .returning({ id: toolCalls.id });
  return row!.id;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n…（截断）' : s;
}

export function safeJsonParse(s: string | undefined): unknown {
  if (!s) return undefined;
  // 1. 直接 JSON.parse
  try {
    return JSON.parse(s);
  } catch {
    // 2. 剥 ```json ... ``` 或 ``` ... ``` 代码块
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        // fallthrough
      }
    }
    const start = s.indexOf('{');
    if (start < 0) return undefined;
    // 3. 括号平衡扫描，找首个匹配的 outer }
    //    救 mimo 这类偶发末尾多吐 } 的模型（输出 `{...}}` 这种）
    const balancedEnd = findBalancedJsonEnd(s, start);
    if (balancedEnd > start) {
      try {
        return JSON.parse(s.slice(start, balancedEnd + 1));
      } catch {
        // fallthrough
      }
    }
    // 4. 退路：抓最外层 {...}（lastIndexOf）
    const end = s.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/** 从 startIdx 处的 `{` 出发，括号平衡扫描（忽略字符串内 + 转义），返回匹配 `}` 的 index；找不到返回 -1。 */
function findBalancedJsonEnd(s: string, startIdx: number): number {
  if (s[startIdx] !== '{') return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
