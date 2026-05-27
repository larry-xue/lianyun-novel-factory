import { describe, expect, it } from 'vitest';
import { refineElementDraft } from './element-curator.ts';

describe('refineElementDraft', () => {
  it('rejects invalid input via zod before hitting the model', async () => {
    await expect(refineElementDraft({})).rejects.toThrow();
    await expect(
      refineElementDraft({ zh: '', category: '世界设定' }),
    ).rejects.toThrow();
  });

  it.skipIf(process.env.RUN_LIVE_LLM_TESTS !== '1')(
    'returns a valid ElementDraft when the real LLM endpoint is configured',
    async () => {
      const draft = await refineElementDraft({
        zh: '废土摩托',
        category: '桥段',
        hint: '末世题材的代步与战斗工具',
      });
      expect(draft.zh).toBe('废土摩托');
      expect(draft.definitionMd.length).toBeGreaterThan(80);
      expect(draft.hotScore).toBeGreaterThanOrEqual(0);
      expect(draft.hotScore).toBeLessThanOrEqual(1);
    },
    60_000,
  );
});
