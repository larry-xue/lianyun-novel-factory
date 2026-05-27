# 炼云小说工厂 — 架构设计

> 本文档是当前实现的快照。v2 重设计（S1-S0 实施完成，10 个 commit）的目标态见 `docs/redesign-v2.md`。

## 1. 顶层闭环

工作台形态：用户从 chat 立项 → 三道 gate 把控 → 章节增量生成 → 各产物 UI 可看可手编。

```
[/books] 用户输入 idea
   │
   ▼
[/books/$bookId/chat]  user ↔ topic-scout 多轮，候选卡 + 确认立项
   │
   ▼
produceForExistingBook（=outline-architect + characters + outline_nodes + world-keeper）
   │
   ▼
gate-1（auto-with-confirm 模式）⏸ 等用户确认
   │ approve
   ▼
runChapterLoop（fully-auto）  /  writeNextChapter（增量按钮）
┌─── 章节循环（idx 1..N，每章一次 writeOneChapter） ───┐
│ listOpenForChapter → 可回收伏笔清单                  │
│   ▼                                                  │
│ [chapter-writer] ──▶ contentMd + threadActions       │
│   ▼                                                  │
│ [consistency-guard] ──▶ 校验 thread-action-incoherent │
│   │ failed → 重写                                    │
│   ▼ passed                                           │
│ [hook-smith] / [style-polisher]                      │
│   ▼                                                  │
│ chapters / chapter_revisions / book_states 入库       │
│ applyThreadActions → plot_threads / events           │
│ markOverdueAsAbandoned 章末扫超期                     │
│ [world-keeper] / 每 K 章 [arc-summarizer] / [plan-reviser] │
│ 早期淘汰：首章字数 < 阈值 → book.status='killed'      │
└──────────────────────────────────────────────────────┘
   │
   ▼
卷末（手动触发）：finalizeVolume = summarizeVolume + mergeStyleProfileFromVolume
```

**两种触发**：
- 一键 `produceBook`（fully-auto，全自动跑完）— 老路径，e2e smoke 用
- chat 立项 → produceForExistingBook（auto-with-confirm）— gate-1 暂停 + UI approve；之后 resumeAfterGate1 一路写完
- 单章按钮 `writeNextChapter`（增量）— 已写出 N 章后想再写一章

铺量场景：`enqueueBatch` 把 N 个 `produceBook` 任务塞进 pg-boss `produce-book` 队列并发执行；早期淘汰省 token。

## 2. 数据模型分层（v2 现状）

| 层 | 表 | 角色 |
|---|---|---|
| **复利知识库** | `elements` `style_samples` `style_profiles` `hooks` `anti_patterns` | 跨书沉淀；style_profiles 含 `version`/`parent_id` 父子链（卷末滚动蒸馏写新版） |
| **立项** | `topic_cards` `topic_negotiations` `book_briefs` | chat 流：messages jsonb 数组 + 立项参数（章数/字数/卷数/弧数/pacing/forbidden）|
| **大纲** | `outline_nodes` `outline_revisions` | 自引用三层（卷→弧→章节拍）+ 旧版扁平 chapter_plan 快照 |
| **业务实体** | `books` `characters` `chapters` `chapter_revisions` `book_states` `world_rules` `arc_summaries` `volume_summaries` | books 加 `gate_mode` enum 控暂停；book_states 删了 openThreads 字符串列 |
| **状态 / 伏笔** | `plot_threads` `plot_thread_events` | 结构化伏笔追踪：weight(small/arc/book)、status(open/hinted/paying/paid_off/abandoned)、期望窗口、触发条件 + 章节级事件流 |
| **活文档** | `book_docs` `book_doc_kinds` `book_doc_revisions` | 通用 markdown 活文档（地图/关系/时间线/设定/AI 自创 kind）+ 编辑历史 |
| **gate** | `gate_requests` | 三档（gate-1/2/3）暂停请求 + payload + 审批留痕 |
| **prompt 仓** | `prompts` `prompt_revisions` | 所有 agent 的 SYSTEM 模板，UI 可改/回滚；agent 通过 `loadPromptOrFallback(slug, SYSTEM)` 懒加载 |
| **观测** | `runs` `llm_calls` `batches` `batch_jobs` | 每次 LLM 调用都可重放 |

### 2.1 单本书的"维护层"

| 表 | 写入者 | 读取者 |
|---|---|---|
| `world_rules` | `world-keeper` | `chapter-writer`（强制规则）+ `consistency-guard`（判据） |
| `arc_summaries` | `arc-summarizer`（每 K 章） | `book-summarizer`、`plan-reviser`、未来的 chapter-writer 长上下文压缩 |
| `volume_summaries` | `summarizeVolume`（卷末手动） | 风格 merge 输入；UI 卷视图 |
| `outline_revisions` | `plan-reviser`（每 M 章） | 审计 + 回滚；`books.outlineMd` 永远指向最新版本 |
| `outline_nodes` | `outline-architect`（立项时插完整树）+ `plan-reviser` | UI `/books/$bookId` 大纲树视图 |
| `plot_threads` | chat 流的 `applyThreadActions`（写章后写入 introduce/hint/pay 事件）+ `markOverdueAsAbandoned`（自动 abandon） | `chapter-writer`（写章前读 P0/P1 清单）+ `consistency-guard`（校验兑现）+ UI 伏笔看板 |
| `book_docs` | UI 手编 / agent upsert | UI 文件树 + 未来 chapter-writer 注入 |
| `gate_requests` | `produceForExistingBook` / 未来 gate-2/3 触发点 | UI 书页顶部 ⏸ 面板 + `approveGateFn` → `resumeAfterGate1` |
| `books.bookSummaryMd` | `book-summarizer` | 列表页展示 + 中后期 chapter-writer "我这本书在讲啥"回看 |
| `books.meta.outlineDraft / produceCfg` | `produceBook`/`produceForExistingBook` 在创建时存 | `resumeAfterGate1` / `writeNextChapter` rehydrate（不靠 in-memory 重启依然能续） |

**字段约束**（重申 AGENTS.md）：
- 长文本统一 `*_md` 后缀（markdown），内部不强制结构（agent 整篇覆盖）
- 标签数组用 `text[]`
- 自由结构用 `jsonb`
- 时间戳：`created_at` / `updated_at`
- 凡是"AI 可能扩"的 kind 走 `text + 旁路 lookup 表`，不用 pgEnum 锁死（如 `book_docs.kind` + `book_doc_kinds`）

## 3. Agent / Skill 列表

`✓ prompts` 列表示 SYSTEM 已 seed 进 `prompts` 表，agent 走 `loadPromptOrFallback('<id>.system', SYSTEM)` 懒加载，`/prompts/$slug` UI 编辑后下次调用即生效。

| id | 输入 → 输出 | 持久化 | 触发点 | prompts |
|---|---|---|---|---|
| `element-curator` | slug + 中文名 → 完整 element 卡 | upsert `elements` | 手工 / 词典页 | — |
| `topic-scout` | brief + element 偏好 → N 张候选 + 推理 + 追问 | 不入库（讨论态） | `/books/$bookId/chat` 多轮对话 | ✓ |
| `outline-architect` | 选题 → 主线 + N 章摘要 + 角色粗稿 + volumes 三层 | 写 `books` `characters` `book_states[0]` `outline_nodes` | `produceBook` / `produceForExistingBook` | ✓ |
| `character-keeper` | 角色粗稿 → 精细角色档案 | upsert `characters` | 调用 `refineCharacter` | — |
| `chapter-writer` | 大纲 + 上一章 state + 风格指纹 + 可回收伏笔清单 → 章节稿 + threadActions | 写 `chapters` `chapter_revisions(raw)` `book_states[idx]` | 每章 | ✓ |
| `consistency-guard` | 章节稿 + outline + state + plot_threads + threadActions → ConsistencyReport（含 thread-action-incoherent） | 不入库；驱动重写 | 每章 | ✓ |
| `hook-smith` | 章节稿 → 替换章末 + 新 hookMd | `chapter_revisions(hooked)` | 每章（默认开） | — |
| `style-polisher` | 章节稿 + styleProfile → 全章润色 | `chapter_revisions(polished)` | 每章（默认关） | — |
| `world-keeper` | 触发素材 → upserts/deprecates | upsert `world_rules` | outline 之后 + 每章之后 | — |
| `arc-summarizer` | K 章正文 + states → arc 摘要 | upsert `arc_summaries`；S7 复用做 volume 摘要 → `volume_summaries` | `idx % arcSummaryEvery === 0` / 手动 | — |
| `book-summarizer` | 全部 arc → 整本摘要 | 写 `books.bookSummaryMd` | 手工或 produceBook 收尾 | — |
| `plan-reviser` | outline + 已写 + arcs + worldRules → keep/revise/rebuild | 写 `outline_revisions` + 改 `books.outlineMd` | `idx % planRevisionEvery === 0` | — |
| `style-distiller` | N 篇范文 → styleProfile（含 profileMd + params） | 写 `style_profiles` v1；S7 复用做卷末 merge → 写新 version | 风格指纹页 / 卷末 `mergeStyleProfileFromVolume` | ✓ |
| `style-tweaker` | 已有 profile + 调整指令 → 派生 profile | 写 `style_profiles`（带 parent_id） | 风格指纹页 | — |

**Skill 三件套约定**（AGENTS.md）：
1. `app/server/mastra/agents/<id>.ts` — Mastra agent + Zod schema + system prompt（fallback）
2. `app/server/services/<id>.ts` 或 `book-producer.ts` 内联 — 业务逻辑（DB / 调度）
3. `<id>.test.ts` — 至少 schema 单测（mock LLM 不打真接口）

**接 prompts 表的步骤**：
1. agent 文件底部 `import { loadPromptOrFallback } from '../../services/prompts.ts'`
2. `Agent({ instructions: () => loadPromptOrFallback('agent.system', SYSTEM), ... })`
3. `scripts/seed-prompts.ts` 加一条 entry，跑 `pnpm tsx scripts/seed-prompts.ts`

## 4. 关键内部 helper

### `runChildAgent`（`app/server/services/run-tracer.ts`）
所有 agent 调用都走它，负责：
- 写一行 `runs`（status running → success/failure，带 parent_id）
- 写一行 `llm_calls`（prompt / response / 延迟 / token）
- 校验输出 schema
- 返回 `{ runId, result }`

这样 `/runs/$id` 才能拿到完整 trace 树。

### `produceBook` / `produceForExistingBook` / `runChapterLoop` / `writeOneChapter` / `writeNextChapter` / `resumeAfterGate1`（`app/server/services/book-producer.ts`）

5 个入口 + 2 个内部 helper，组合出三种生产路径。共享 `runChapterLoop` 与 `writeOneChapter`。

```
produceBook(input)                     // 老入口，从零创建 books 行
  → outline-architect → INSERT books
  → 非 fully-auto: 创 gate-1 提早返回
  → fully-auto: runChapterLoop()

produceForExistingBook({bookId, gateMode})    // chat 立项闭环
  → 复用现有 books 行，从 brief + topicCard 推 cfg
  → outline-architect → UPDATE books
  → 非 fully-auto (默认 auto-with-confirm): 创 gate-1 提早返回
  → fully-auto: runChapterLoop()

resumeAfterGate1(bookId)               // gate-1 approve 后由 approveGateFn fire-and-forget 调
  → 从 books.meta.{outlineDraft, produceCfg} rehydrate
  → runChapterLoop()

writeNextChapter(bookId)               // 单章按钮（增量）
  → rehydrate
  → 算 nextIdx = max(existing chapter.idx) + 1
  → writeOneChapter(idx=nextIdx)
  → 最后一章自动 books.status='completed'

[内部] runChapterLoop(opts)            // for 1..totalChapters: writeOneChapter(idx)
[内部] writeOneChapter({...opts, idx}) // 单章全套副作用：generate / guard / hook / polish / 入库 / bookStates / threadActions / markOverdue / world-keeper / arcSummary / planRevision
```

ProduceInput 入参（部分）：
```ts
{
  topicTitle, pitch, elementSlugs,            // 必填
  totalChapters: 1, charsPerChapter: 3000,    // 现在范围放宽到 1-2000 章 / 500-8000 字
  gateMode: 'fully-auto',                      // 'fully-auto' / 'auto-with-confirm' / 'manual'
  styleProfileId?,                             // 可选风格指纹
  earlyKillBelowChars: 2200,                   // 首章淘汰阈值
  maxGuardRetries: 1,                          // guard 失败时的重写上限
  useHookSmith: true,                          // 章末强化
  useStylePolisher: false,                     // 整章润色
  useWorldKeeper: true,                        // 维护 world_rules
  arcSummaryEvery: 5,                          // 每 5 章出一份 arc 摘要
  planRevisionEvery: 0,                        // 0 = 不主动改大纲
}
```

### `finalizeVolume` / `summarizeVolume` / `mergeStyleProfileFromVolume`（`app/server/services/volume-summaries.ts`）

卷末手动调用：
- `summarizeVolume(bookId, volumeIdx, range)` — 复用 `arc-summarizer` agent 写 `volume_summaries` 行
- `mergeStyleProfileFromVolume(bookId, volumeIdx, range, currentProfileId, newWeight=0.4)` — 拉本卷章节正文 → `style-distiller` agent 输出新版指纹（保留旧 60% 主体 + 吸收新 40%），写新行 `style_profiles(parent_id, version+1)`
- `finalizeVolume({...})` — 包装：summarize + 可选 mergeStyle（书有 styleProfileId 才生效）

### `enqueueBatch`（`app/server/services/orchestrator.ts`）
启动一次铺量。输入：N 个 `produceBook` 入参 + 并发数 + 早期淘汰阈值。
- 写 `batches` + 一行 `batch_jobs` per topic
- pg-boss 单例（schema=`pgboss`）队列 `produce-book`，worker 调 `produceBook`
- 完成后聚合 jobsCompleted / jobsKilled / jobsFailed 到 `batches`

### `loadPromptOrFallback`（`app/server/services/prompts.ts`）
- 永不抛错：DB 缺失 / slug 没 seed / 表为空时回退到硬编码 SYSTEM
- agent 的 `instructions: () => loadPromptOrFallback(slug, SYSTEM)` 是 Mastra `DynamicArgument` 的标准用法，每次 agent 被调用都 resolve 一次

### gate 服务（`app/server/services/gates.ts`）
- `createGateRequest({bookId, kind, payload, noteMd, triggeredByRunId})` — pg-boss 任务想暂停时调
- `listPendingForBook` / `listAllForBook` — UI 顶部琥珀面板
- `approveGate` / `rejectGate` — 只能改 pending 状态；double-approve 报错
- 当前只挂了 gate-1（`produceForExistingBook`）。gate-2/3 服务接口在但未挂触发点

## 5. 序列化坑（重要）

drizzle 把 jsonb 列推断为 `Record<string, unknown>`，TanStack Start 的 `createServerFn().handler()` 会拒绝 `unknown` 字段，typecheck 直接红。
解决：所有返回含 jsonb 列的 ServerFn 必须：
1. 顶部声明 `interface SerializedX { ... meta: JsonObject ... }`，使用 `app/server/fns/_serializable.ts` 里的 `JsonObject` / `JsonValue`
2. handler 末尾 `return rows as unknown as SerializedX[]`（先转 unknown 再到目标类型）

`JsonValue` 不能写成 `Record<string, JsonValue>`（会报循环引用），必须用 `{ [k: string]: JsonValue }`。

## 6. 路由树

```
/                                          仪表盘
/workshop                                  单步工作台（agent 沙盒）
/prompts                                   ★ Prompt 仓（5 个 agent SYSTEM 已 seed）
  /$slug                                   单 prompt 编辑 + 版本历史 + 回滚
/elements + /elements/$id                  元素词典
/styles/profiles + /$id                    风格指纹（蒸馏 + tweak 派生 + S7 滚动 merge）
/styles/samples                            范文库
/hooks / /anti-patterns                    Hook / 反例
/topics                                    选题（topic-scout 多轮讨论 → approve；老入口）
/books                                     ★ 书架（输入 idea → 跳 chat 立项；不再有旧表单）
/books/$bookId                             ★ 书页 layout（仅 Outlet）
/books/$bookId/                            ★ 详情：⏸ 等待 gate 面板 / 写第 N 章按钮 /
                                            分层大纲树 / 卷摘要 / arc / 章节 / 世界观规则 / state 轨迹
/books/$bookId/chat                        ★ 立项 chat（消息流 + 候选卡 + 确认立项）
/books/$bookId/files                       ★ 文件树（按 kind 分组的活文档）
/books/$bookId/files/$kind/$slug           ★ md 编辑器 + 版本历史 + 删除
/books/$bookId/threads                     ★ 伏笔看板（按 status / weight 过滤 + P0 高亮）
/batches + /batches/$id                    铺量批次进度
/runs + /runs/$id                          跑批 trace 树 + replay
```

★ = v2 新增。

## 6.1 三种从想法到章节的路径

| 路径 | 入口 | 触发 |
|---|---|---|
| chat 立项（推荐） | `/books` 输入想法 → chat → 确认立项 | `confirmTopicFn` 同步 await `produceForExistingBook(gateMode='auto-with-confirm')` → 跳书页见 gate-1 → 点确认 → 后台跑章节循环 |
| 一键 fully-auto | `produceBookFn` server-fn 直调（脚本 / e2e smoke） | 一路跑到底，不暂停 |
| 增量续写 | 已写 N 章后书页"写第 N+1 章"按钮 | `writeNextChapter` rehydrate + 单章 |

## 7. 不会做（节制清单）

- **不引入** LangChain / mem0 / Langfuse 自建：DevTools + 自有 `runs/llm_calls` 表已足够。
- **不启用** pgvector：到真有语义召回需求再开。
- **不部署** 单独的 `topic-scout` 一键自动跑：选题必须用户参与（topic-scout 是讨论助手，不是审批者）。
- **不在前后端各写一份 schema**：Zod 共享。

## 8. 节拍规划（自顶向下）

`outline-architect` 在生成 N 章大纲时，必须先做"整本节拍曲线"，每章带 `pacingPhase` 标签：

| pacingPhase | 占比 | 阶段目标 |
|---|---|---|
| 开端 | 0-15% | 立人设/世界规则/触发主冲突 |
| 上升 | 15-50% | 主线递进、积累信息差 |
| 中段反转 | 50-65% | 大反转/低谷，让读者怀疑结局 |
| 高潮 | 65-90% | 主线矛盾全面爆发 |
| 收尾 | 90-100% | 解决悬念、回收伏笔 |

`chapter-writer` 在每章 user prompt 里收到 `pacingPhase` + `位置 (idx/N)` + 阶段节奏要求，**严禁超越本 phase 进度**——这是为了避免"在前 1/3 就把高潮抛出去"的常见失控。

`books.meta.pacingPlanMd` 存整本节拍曲线说明，`/books/$bookId` 详情页有专门 panel。

`PACING_PHASES` 常量定义在 `app/server/mastra/agents/outline-architect.ts`，每个 chapterSummary 用 `pacingPhaseLenient`（`.optional().catch().transform()` 三段套娃）兜底，模型给非法 phase 时自动降到 '上升'。

## 9. 待办（v2 后续）

**S2.5 / S5 遗留**：
- `worldRules.kind` 仍是 pgEnum，按 P8 原则后续改 text + lookup（与 `book_doc_kinds` 同构）

**S3 / S5 读侧**：
- chapter loop 仍读 `outlineDraft.chapterSummaries` 扁平结构；未来 producer 真正按"卷"概念跑时切到 `outline_nodes` 树驱动
- `outline_nodes` 现在只写不读（仅书页 UI 看树）

**S7 触发**：
- `finalizeVolume` 服务在但没自动触发点。等 producer 有"卷"边界检测后挂入卷末

**S8 半成品**：
- gate-2（卷规划）/ gate-3（单章）的 service 模板就绪，但 `produceBook` / `runChapterLoop` 里没有挂入 `createGateRequest` 调用点。等 producer 拆出 `runVolume` / 单章 gate 检查时一起加
- gate UI 是 polling-free（每次刷新页面才看到），后续可上 5s polling

**S0 prompts 表**：
- 当前 5 个 agent 切到 `loadPromptOrFallback`：consistency-guard / chapter-writer / outline-architect / topic-scout / style-distiller
- 剩余 7 个尚未切：character-keeper / hook-smith / style-tweaker / style-polisher / world-keeper / arc-summarizer / plan-reviser / element-curator。模板未 seed
- prompt smoke test（保存时跑一次 mock 调用确认 schema 还能解析）

**v1 待办继承**：
- `topic-scout` 接入"采集到的爆款数据回流"做评分校准
- `chapter-writer` 接入 arc 摘要做长上下文压缩
- `world-keeper` 跟 `consistency-guard` 闭环：guard 发现的违规自动反推到 world_rules 改 status
- 数据回流：平台追读/完读率导回 `topic_cards.score`
- pgvector + 范文/钩子语义召回（按需）
