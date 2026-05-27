import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getSetting, upsertSetting } from '../services/platform-settings.ts';
import { getCurrentLlmConfig, setLlmConfig } from '../llm/client.ts';
import { requireAdmin } from '../auth/session.ts';
import { logAudit } from '../services/audit.ts';
import { probeLlm, type LlmProbeResult } from '../services/llm-health.ts';
import type { JsonObject } from './_serializable.ts';

export interface PlatformSettingsView {
  /** 当前生效的 LLM 配置（db 优先，否则 .env）。keyMasked 永不返回明文。 */
  llm: {
    endpoint: string;
    model: string;
    keyMasked: string;
    /** 配置来源：db 表 vs .env fallback。UI 用来提示「还在 .env 兜底，建议存 db」 */
    source: 'db' | 'env' | 'none';
  };
  produceDefaults: JsonObject;
}

function maskKey(key: string): string {
  if (!key) return '';
  return key.length > 8 ? key.slice(0, 4) + '****' + key.slice(-4) : '****';
}

export const fetchSettingsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlatformSettingsView> => {
    await requireAdmin();
    // 优先读 db；db 没有时退回 .env
    const dbLlm = await getSetting('llm-config');
    let llmView: PlatformSettingsView['llm'];
    if (dbLlm && typeof dbLlm.endpoint === 'string' && typeof dbLlm.apiKey === 'string') {
      // 顺手同步到 client singleton：长跑进程（dev server）启动后用户首次访问
      // /settings 时把 db 配置激活，无需专门 startup hook
      const current = getCurrentLlmConfig();
      const model = typeof dbLlm.model === 'string' ? dbLlm.model : 'gpt-4o-mini';
      if (
        !current ||
        current.endpoint !== dbLlm.endpoint ||
        current.apiKey !== dbLlm.apiKey ||
        current.model !== model
      ) {
        setLlmConfig({ endpoint: dbLlm.endpoint, apiKey: dbLlm.apiKey, model });
      }
      llmView = {
        endpoint: dbLlm.endpoint,
        model,
        keyMasked: maskKey(dbLlm.apiKey),
        source: 'db',
      };
    } else {
      const endpoint = process.env.LLM_API_ENDPOINT ?? '';
      const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
      const key = process.env.LLM_API_KEY ?? '';
      llmView = {
        endpoint,
        model,
        keyMasked: maskKey(key),
        source: endpoint && key ? 'env' : 'none',
      };
    }

    const saved = await getSetting('produce-defaults');

    return {
      llm: llmView,
      produceDefaults: (saved ?? {}) as JsonObject,
    };
  },
);

const LlmConfigSchema = z.object({
  endpoint: z.string().min(1).max(200),
  /** 留空表示「不改」（保留 db 里现存的 key），用于 web UI 编辑表单不暴露明文 */
  apiKey: z.string().max(200),
  model: z.string().min(1).max(80),
});

export const saveLlmConfigFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => LlmConfigSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const existing = await getSetting('llm-config');

    const apiKey =
      data.apiKey.trim().length > 0
        ? data.apiKey.trim()
        : typeof existing?.apiKey === 'string'
          ? existing.apiKey
          : process.env.LLM_API_KEY ?? '';

    if (!apiKey) {
      throw new Error('apiKey 不能为空（db 中也没有现存值）');
    }

    const cfg = {
      endpoint: data.endpoint.trim(),
      apiKey,
      model: data.model.trim(),
    };

    await upsertSetting('llm-config', cfg);
    // 立即生效：重建 singleton，本进程下一次 chat() 用新配置
    setLlmConfig(cfg);

    await logAudit({
      user: me,
      action: 'settings.llm.update',
      targetType: 'platform_setting',
      targetId: 'llm-config',
      summary: `更新 LLM 配置：endpoint=${cfg.endpoint} model=${cfg.model}`,
      diff: {
        before: {
          endpoint: typeof existing?.endpoint === 'string' ? existing.endpoint : null,
          model: typeof existing?.model === 'string' ? existing.model : null,
          apiKeyChanged: data.apiKey.trim().length > 0,
        },
        after: { endpoint: cfg.endpoint, model: cfg.model },
      },
    });

    return { ok: true };
  });

export const probeLlmFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<LlmProbeResult> => {
    await requireAdmin();
    return await probeLlm({ timeoutMs: 15_000 });
  },
);

const ProduceDefaultsSchema = z.object({
  totalChapters: z.number().int().min(1).max(5000),
  charsPerChapter: z.number().int().min(500).max(8000),
  gateMode: z.enum(['fully-auto', 'auto-with-confirm', 'manual']),
  earlyKillBelowChars: z.number().int().min(0),
  maxGuardRetries: z.number().int().min(0).max(3),
  useHookSmith: z.boolean(),
  arcSummaryEvery: z.number().int().min(0).max(50),
  planRevisionEvery: z.number().int().min(0).max(20),
  useChapterPlanner: z.boolean(),
  plannerLookbackChapters: z.number().int().min(1).max(10),
});

export const saveProduceDefaultsFn = createServerFn({ method: 'POST' })
  .inputValidator((raw: unknown) => ProduceDefaultsSchema.parse(raw))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const before = await getSetting('produce-defaults');
    await upsertSetting('produce-defaults', data as unknown as Record<string, unknown>);
    await logAudit({
      user: me,
      action: 'settings.produce_defaults.update',
      targetType: 'platform_setting',
      targetId: 'produce-defaults',
      summary: '更新生产默认参数',
      diff: { before: (before ?? {}) as Record<string, unknown>, after: data as Record<string, unknown> },
    });
    return { ok: true };
  });
