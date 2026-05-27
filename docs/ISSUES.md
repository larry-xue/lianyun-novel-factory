# 连云小说工厂 — 问题与反馈记录

> 沉淀产品决策、避坑教训、用户反馈。每条带日期 + 来源 + 后续动作，方便回溯。

---

## 2026-04-30 · 用户反馈

### #1 选题不能"一键自动跑"，必须先和用户讨论
**反馈**："我觉得不能直接跑选题，开始应该是用户先丢一段文案或者要求过去，然后基于这个去和用户讨论选题，用户确认没有问题后开始。"

**为什么**：选题决定了一本书的命门。如果直接让 agent 自由组合元素跑出来，等于把高风险决策让渡给 LLM，最终容易做出"看着合理但 fit 度低"的项目，浪费后面 20 章 token。

**怎么改的**：
- `topic-scout` 改造成多轮对话型：输入 brief（自由文案）+ 元素偏好，输出 N 张候选 + reasoningMd + followUpQuestions（agent 主动追问）
- 不直接入库；用户在 `/topics` 页面看候选 → 可改写 → "确认这条"才走 `approveTopicProposal` 写到 `topic_cards`
- 上一轮 proposals + userFeedbackMd 可作为输入进下一轮，让 agent 吸收反馈再推
- 见 `app/server/services/topic-scout.ts:1`、`app/routes/topics/index.tsx:1`

**留给未来的判断**：如果出现"批量产生候选 + 自动跑前 3 章淘汰差选题"的需求，可以保留这个讨论入口 + 加一条"无监督批量"路径，并把它默认关闭。

---

### #2 单本书的"维护层"还没设计：world_rules / 多层级 summary / 动态 plan 修订
**反馈**：
> 当前还缺乏的小说层面的设计：对每本书自身进行维护：
> - 独立的 world_rules / setting 表来沉淀世界观硬规则
> - 多层级 summary（章 → arc → 整本）
> - 动态 plan 修订（agent 跑到一半改大纲）

**为什么**：原来只有 `book_states`（按章一行）做工作记忆，承载不了"全书一致性 + 长上下文压缩 + 大纲漂移"三类问题。
- 修仙/末世这种世界观稠密的书，没有沉淀点 → 第 5 章法力上限和第 15 章互相打架
- 章级摘要够给"下一章"用，但写第 18 章时已经无法回顾整本走向
- 大纲是写在 `outline-architect` 一次性产出的，写到一半剧情偏了无法纠错

**怎么改的**：
- 新增三张表：`world_rules`、`arc_summaries`、`outline_revisions`（`app/server/db/schema/world.ts:1`）
- `books` 加 `bookSummaryMd` 列 + `outlineVersion` 列
- 新增三个 agent：`world-keeper`（维护规则）、`arc-summarizer` + `book-summarizer`（多层摘要）、`plan-reviser`（动态改大纲）
- 业务逻辑全在 `app/server/services/book-maintenance.ts:1`
- 在 `produceBook` 流程里挂钩：
  - outline 落库后 → 跑 `world-keeper` 沉淀初版规则
  - 每章写完 → 跑 `world-keeper` 增量沉淀
  - `idx % arcSummaryEvery === 0` → `arc-summarizer`
  - `idx % planRevisionEvery === 0` → `plan-reviser`（默认 0 = 关闭，需要明确启用）
- `/books/$bookId` 增加三个 panel：world_rules / arc 摘要 / 大纲修订历史 / 整本摘要

**待跟进**：
- chapter-writer 还没读 arc_summaries 做长上下文压缩，目前只读 `book_states` 最新一行
- consistency-guard 的判定还没主动从 `world_rules` 拉强制规则做 fewshot

---

### #3 沉淀工作流偏好
**反馈**："完成后补充一下测试，并执行，确保所有测试通过。然后维护两份文档，一个架构设计 md，一个问题记录 md 沉淀我反馈和你遇到的问题。"

**怎么落实**：
- 每次大改完都要 `pnpm typecheck && pnpm test`，全绿才算交付
- 文档：`docs/ARCHITECTURE.md` 是当前实现快照（与代码对齐），`docs/ISSUES.md` 是本文（决策 + 反馈 + 踩坑流水）
- 后续每个用户反馈/重大决策 → 续写到本文，不要散落在 commit message 里

---

### #4 默认章数从 20 → 1，并补"自顶向下节拍规划"
**反馈**："去掉一次20章的，默认一次1章。然后增加一个规划，就是当前书要多少字，然后自顶向下规划章节和剧情发展，避免失控，发展太快。"

**为什么**：
- 默认 20 章浪费 token，调试期想要 1 章快进快出
- 上一轮 5 章 e2e 跑出来发现剧情节奏失控倾向：第 1 章已经"重生 + 系统 + 队友 + 反派"全部到位，按这个速度 5 章就能写完一个长篇

**怎么改的**：
- `produceBook.totalChapters` 默认 1（`book-producer.ts:36`）
- `BatchJobInputSchema.totalChapters` 默认 1（`orchestrator.ts:25`）
- `/books` 启动表单默认 1 章；显示"整书预算 ≈ totalChapters × charsPerChapter 字"
- `outline-architect`：
  - 新增 `PACING_PHASES = ['开端','上升','中段反转','高潮','收尾']`
  - schema 加 `pacingPlanMd` 字段（整本节拍曲线说明）+ 每个 `chapterSummary.pacingPhase`
  - system prompt 强制按比例分配阶段；当 N=1 时允许只写 '开端' 阶段
  - 新增 outline-architect 单测（5 个用例）
- `chapter-writer` user prompt 注入 `pacingPhase + 位置 + 节奏要求`，**严禁超越本 phase 进度**
- `/books/$bookId` 加"整本节拍曲线" panel
- `books.meta.pacingPlanMd` 持久化

**留给未来的判断**：
- 上一次 e2e 因为 N=5 + 没有 pacing 约束，第 1 章就把所有信息抛了。下次跑 e2e 看 phase 约束效果。
- 如果模型仍然倾向于"前期塞太多"，可以在 chapter-writer 的字数硬指标后面加"本章不要触及超过 X 个新事件"。

## 工程踩坑

### P1 · TanStack Start 拒绝 `Record<string, unknown>` 序列化
**症状**：新加 ServerFn 返回含 jsonb 列的 drizzle row 时，typecheck 报：
```
Type 'unknown' is not assignable to type 'SerializationError<"Type may not be serializable">'.
```

**根因**：drizzle `jsonb('meta').$type<Record<string, unknown>>()` 推断结果含 `unknown`，TanStack Start 的 `ValidateSerializableMapped` 工具类型把它当成不可序列化拒了。

**解法**（已归纳到 memory）：
1. `app/server/fns/_serializable.ts` 提供 `JsonValue` / `JsonObject` 类型别名（注意：不能递归写成 `Record<string, JsonValue>`，TS 会报循环引用，必须 `{ [k: string]: JsonValue }`）
2. fn 文件顶部声明 `interface SerializedX { ... meta: JsonObject ... }`
3. handler 末尾 `return rows as unknown as SerializedX[]`（必须先 unknown 再到目标，否则 TS 拒）

涉及表：`books.meta`、`runs.input/output`、`llm_calls.prompt/responseJson`、`topic_cards.score`、`style_profiles.params`、`batches.meta`、`batch_jobs.resultMeta`、`world_rules.meta`、`outline_revisions.meta`、`outline_revisions.chapter_plan`。

### P2 · zod v4 的 UUID 校验更严格
**症状**：测试里写 `'00000000-0000-0000-0000-000000000001'` 过不了 `z.string().uuid()`。

**根因**：zod 4 把 UUID 限制成 v1-v8（version 字段必须 1-8），全 0/全 1 不再合法。

**解法**：测试用真正的 v4 占位 UUID，比如 `'11111111-1111-4111-8111-111111111111'`。

### P3 · zod 的 string min 是 UTF-16 码元数
**症状**：`z.string().min(2)` 拒掉单字符的"试"，但 `'试题'` 通过。

**根因**：UTF-16 码元数。中文 BMP 字符 1 码元，所以 `min(2)` 至少要两个汉字。`pitch` 类似：`min(10)` ≈ 10 个汉字。

**解法**：测试用例写够长度。日常面用户的输入本来就够长，不是问题。

### P4 · drizzle-kit 手写 migration 与生成的 migration 会冲突
**症状**：试图手写 `0001_add_batches.sql` 来"绕过"db:generate；下次跑 db:generate 会重新生成 0002 与手写 0001 重叠。

**解法**：永远走 `pnpm db:generate` 让 drizzle-kit 自己 diff 出 migration。不要手写。手写文件在被发现时及时删除。

### P5 · 测试 DB 必须先迁移
**症状**：`schema.test.ts` 跑出 `column "outline_version" of relation "books" does not exist`。

**根因**：测试直连 docker postgres；新 schema 没 push。

**SOP**：
1. 改 schema → `pnpm db:generate`
2. `pnpm db:migrate` 应用到 docker
3. 再 `pnpm test`

如果要彻底重置：`pnpm db:reset`（会清数据 + 重跑 seed）。

---

### P6 · zod 4 的 lenient 字段三段套娃
**症状**：LLM 在可选字段经常返回 null、错类型、或干脆省略 key。zod 4 默认严格——`.default()` 不接受 null，`.catch()` 不处理 missing key（报 `nonoptional` 错误）。

**解法**：单字段必须 `.optional().catch(def).transform(v => v ?? def)` 三段连写，才能同时容忍：
- 键缺失（optional 接住 → undefined → transform → def）
- null（catch 接住 → def）
- 类型错（catch 接住 → def）

抽到 `app/server/mastra/agents/_zod-helpers.ts` 的 `lenientString()` / `lenientStringArray()` + 各 enum 字段（kind / status / pacingPhase）单独写。

`scripts/zod-probe.ts` 是 zod 4 行为探针脚本，未来怀疑 zod 行为时可以快速验证。

## 当前未解决的判断

- **plan-reviser 默认关闭**：`planRevisionEvery: 0`。开了之后每隔几章就跑一遍，会显著增加 token 消耗，且初期可能"误判"频繁改大纲。建议先在单本书上手工开 `planRevisionEvery: 10` 试，观察修订决策是否稳定再纳入默认值。
- **早期淘汰阈值 2200 字**：选自 3000 字目标的 ~73%。如果发现大量首章在 2000-2400 区间被砍，可能要么提高 chapter-writer 的字数稳定性，要么放宽到 2000。
- **首章淘汰只看一个指标（字数）**：理想还应该看 hookMd 强度、首章 consistency-guard 评分、首章 token 是否超预算。下次产生数据后再校准。
