# 连云小说工厂 v2 — 工作台 + 长程一致性 重设计

> 这份是**目标态**设计稿。S1-S0 已全部实现并合并主干（10 个 commit + 1 个闭环补丁）。
> 实现快照见 `docs/ARCHITECTURE.md`；剩余 follow-up 见末尾 §11。

## 实现状态（2026-04）

| step | 状态 | commit | 关键交付 |
|---|---|---|---|
| S1 | ✅ | `8792ef2` | plot_threads + plot_thread_events + 68 行 backfill + 平行写入 |
| S2 | ✅ | `15ccc8c` | chapter-writer threadActions 声明 + consistency-guard thread-action-incoherent 校验 |
| S3 | ✅ | `efd6517` | outline_nodes 自引用三层 + outline-architect 出 volumes |
| S4 | ✅ | `324a7e9` | book_briefs + topic_negotiations + /books/$bookId/chat |
| S5 | ✅ | `b282bf5` | gateMode 字段 + drop bookStates.openThreads + 清理读侧 |
| S6 | ✅ | `7e93cda` | book_docs + book_doc_kinds + /books/$bookId/files md 编辑器 |
| S7 | ✅ | `d490d19` | volume_summaries + style_profiles version 父子链 + finalizeVolume 接口 |
| S8 | ✅ | `601c29c` | gate_requests + UI approve + resumeAfterGate1 |
| S0 | ✅ | `995d58a` | prompts 表 + UI + seed 5 个 SYSTEM 模板 |
| 闭环 | ✅ | `0c42fbe` | chat→gate-1 自动触发 + writeNextChapter 增量入口 + 5 agent 切到 loadPromptOrFallback |
| UI 入口补全 | ✅ | （本 commit）| sidebar 加 /prompts 入口 + /books/$bookId/threads 看板 + 书页加 outline 树 / volumes 视图 |

未做的部分迁到 §11 follow-up 清单。

---

## 0. 这次重设计为什么

v1 把"批量铺量 + 早期淘汰"做出来了：一条命令跑通 20 章、字数能 hold、guard 能拦。但暴露三个真问题：

1. **人工介入太少。** 按一次按钮 → 20 章掉出来，中间没有审稿/调整窗口。要做到 1000 章必须能让人类主编随时介入。
2. **中间产物不可见、不可手编。** 大纲、世界观、伏笔都埋在 PG 列里，没有"打开看 / 改一行 / 保存"的体验。
3. **长程一致性的数据结构不够。** `bookStates.openThreads` 是字符串数组，agent 没法可靠回答"哪些坑该收了"。`outlineRevisions` 只有章级一层，没有卷 / 弧。

**v2 的形态**：AI 助手 + 人类主编的协作工作台。文件树 UI、三道 gate、分层大纲、结构化伏笔、滚动蒸馏。

---

## 1. 设计原则（拍板的）

| # | 原则 | 含义 |
|---|---|---|
| P1 | **存储混合，UI 统一** | 长文本走 markdown 列，可查询状态走结构化字段。文件树 UI 把两者都渲染成 md 视图，编辑分别走 md 编辑器或表单 |
| P2 | **gate 默认开，可关** | 立项 / 卷规划 / 单章三道 gate；smoke 模式一键全自动通过，不影响 e2e 验收 |
| P3 | **手动编辑只前向** | 改产物不会回溯校验已写章节，只影响后续 |
| P4 | **不强行圆坑** | 伏笔超期自动 abandoned，不修改前文 |
| P5 | **滚动蒸馏，不堆 context** | 章 → 弧 → 卷 三层蒸馏；写下一章只组装"当前需要的最小集" |
| P6 | **PG 是 source of truth** | 不引入文件系统作为主存。导出到磁盘只做镜像/备份用 |
| P7 | **md 内部不强制结构** | 所有 `*_md` 列内容由模型自由输出，不要求章节锚点/字段标记。需要结构化的字段就单独建列 |
| P8 | **分类不写死** | 凡是"AI 可能想自己引入新种类"的字段（如 `book_docs.kind`）一律走 `text + 旁路 lookup 表`，不用 pgEnum 锁死 |
| P9 | **prompt 也是产物** | 所有 agent 的 system prompt + 每次调用的 user prompt 模板都进 `prompts` 表，可在 UI 里看版本/编辑/回滚 |

---

## 2. 数据模型增量

### 2.1 新增表

#### `plot_threads` — 结构化伏笔追踪（替代 `bookStates.openThreads`）

```ts
plotThreads = pgTable('plot_threads', {
  id: uuid().primaryKey(),
  bookId: uuid().references(books).notNull(),
  slug: text().notNull(),                          // 'thread-mysterious-letter'
  title: text().notNull(),                         // '神秘信件的真正寄件人'
  weight: pgEnum('thread_weight', ['small', 'arc', 'book']).notNull(),
  status: pgEnum('thread_status', [
    'open',        // 已埋未动
    'hinted',      // 后续章节有提及/暗示
    'paying',      // 正在回收
    'paid_off',    // 已回收
    'abandoned',   // 超期作废，不强行圆
  ]).notNull().default('open'),
  introducedAtChapterIdx: integer().notNull(),
  expectedPayoffStart: integer().notNull(),        // 期望回收窗口
  expectedPayoffEnd: integer().notNull(),
  payoffTriggerMd: text().notNull(),               // '主角第一次离开新手村后' 等自然语言条件
  relatedCharacterIds: uuid().array().notNull(),
  relatedRuleSlugs: text().array().notNull(),
  detailMd: text().notNull(),                      // 伏笔本身的内容（什么细节、为什么重要）
  payoffNotesMd: text().default(''),               // 回收时填：怎么收的、关联章节
  ...timestamps,
  unique('plot_threads_book_slug_unique').on(t.bookId, t.slug),
})

// 章节关联表：一个章节涉及哪些伏笔（埋/暗示/回收）
plotThreadEvents = pgTable('plot_thread_events', {
  id: uuid().primaryKey(),
  threadId: uuid().references(plotThreads).notNull(),
  chapterIdx: integer().notNull(),
  kind: pgEnum('thread_event_kind', ['introduce', 'hint', 'pay', 'abandon']).notNull(),
  noteMd: text().notNull(),
  ...timestamps,
})
```

**为什么不放 markdown**：收坑机制要靠 `where status='open' and current_chapter > expectedPayoffEnd` 这样的 SQL 查询，md 解析不可靠。

#### `outline_nodes` — 分层大纲（替代 `outlineRevisions.chapterPlan` 单层）

```ts
outlineNodes = pgTable('outline_nodes', {
  id: uuid().primaryKey(),
  bookId: uuid().references(books).notNull(),
  parentId: uuid().references(outlineNodes),       // 自引用：null=卷, 卷=>弧, 弧=>章节拍
  level: pgEnum('outline_level', ['volume', 'arc', 'chapter']).notNull(),
  idx: integer().notNull(),                        // 同 parent 下的序号
  title: text().notNull(),
  summaryMd: text().notNull(),
  intent: text().notNull().default(''),            // 仅 chapter 级有意义
  pacingPhase: text().default(''),                 // '开端'/'上升'/'高潮'/'收尾'
  status: pgEnum('outline_node_status', ['planned', 'writing', 'done', 'revised', 'skipped'])
    .notNull().default('planned'),
  // 章节拍专属：若已写，指向 chapter row
  chapterId: uuid().references(chapters),
  // 关联：本节预计触发哪些伏笔事件
  expectedThreadEvents: jsonb().$type<Array<{ threadSlug: string; kind: string }>>()
    .notNull().default([]),
  generatedByRunId: uuid(),
  ...timestamps,
  unique('outline_nodes_book_parent_idx_unique').on(t.bookId, t.parentId, t.idx),
})
```

**保留 `outlineRevisions`** 做版本快照（每次 plan-reviser 重规划时 dump 当前 outline_nodes 的全树）。

#### `book_docs` — 通用"活文档"（人物关系 / 地图 / 时间线 / 设定 / AI 自创类型）

```ts
// kind 用 text + 旁路 lookup 表，不用 pgEnum：让 agent 可以自己开新类型
bookDocs = pgTable('book_docs', {
  id: uuid().primaryKey(),
  bookId: uuid().references(books).notNull(),
  kind: text().notNull(),                          // 'relations'/'map'/'timeline'/'lore'/任意 AI 新增
  slug: text().notNull(),                          // 同 kind 下可多个：'map-main-continent'
  title: text().notNull(),
  contentMd: text().notNull(),                     // 完全自由，不要求结构
  version: integer().notNull().default(1),
  lastEditedBy: pgEnum('doc_editor', ['agent', 'human']).notNull().default('agent'),
  generatedByRunId: uuid(),
  ...timestamps,
  unique('book_docs_book_kind_slug_unique').on(t.bookId, t.kind, t.slug),
})

// kind 注册表：append-only，agent 引入新 kind 时先 upsert 这里再写 doc
// 既给 UI 当文件树分组用，又给后续 agent 提供"已有哪些 kind 可选"的提示
bookDocKinds = pgTable('book_doc_kinds', {
  slug: text().primaryKey(),                       // 'relations', 'map', 'cultivation-tree', ...
  zh: text().notNull(),                            // '人物关系', '地图', '修炼体系图', ...
  descriptionMd: text().notNull().default(''),    // 这种 kind 用来记什么
  introducedBy: pgEnum('doc_editor', ['agent', 'human']).notNull().default('human'),
  introducedAt: timestamp().notNull().defaultNow(),
})

// 编辑历史
bookDocRevisions = pgTable('book_doc_revisions', {
  id: uuid().primaryKey(),
  docId: uuid().references(bookDocs).notNull(),
  version: integer().notNull(),
  contentMd: text().notNull(),
  editedBy: pgEnum('doc_editor', ['agent', 'human']).notNull(),
  reasonMd: text().default(''),
  runId: uuid(),
  ...timestamps,
})
```

**预置 kind**（seed 进 `book_doc_kinds`，agent 可加）：`relations` / `map` / `timeline` / `lore` / `forbidden` / `reader_notes`

**与 `worldRules` 的分工**：`worldRules` 是"硬规则"（魔法体系、等级、地理常量），细粒度 + 强 status，agent 用作硬约束。`bookDocs` 是"叙事性长文档"，整篇编辑，agent 用作软参考。

**注意**：现有 `worldRules.kind` 也是 pgEnum，按 P8 原则后续也应改成 text + lookup（见 §9 迁移）。本期先不动，避免改动面过大。

#### `topic_negotiations` — 立项聊天历史

```ts
topicNegotiations = pgTable('topic_negotiations', {
  id: uuid().primaryKey(),
  topicCardId: uuid().references(topicCards),      // 确认后绑定，draft 期间为 null
  bookId: uuid().references(books),                // 立项后绑定
  status: pgEnum('negotiation_status', ['active', 'confirmed', 'abandoned']).notNull(),
  messages: jsonb().$type<Array<{
    role: 'user' | 'agent';
    contentMd: string;
    candidates?: Array<{                            // agent 一次出多个候选时
      kind: 'topic' | 'element-set' | 'logline' | 'character-pool';
      title: string;
      bodyMd: string;
      pickedByUser?: boolean;
    }>;
    timestamp: string;
  }>>().notNull().default([]),
  ...timestamps,
})
```

#### `book_briefs` — 立项时的"盘子"

```ts
bookBriefs = pgTable('book_briefs', {
  bookId: uuid().primaryKey().references(books),   // 1:1
  targetTotalChapters: integer().notNull(),        // 总章数（如 1000）
  targetCharsPerChapter: integer().notNull(),      // 单章字数（如 3000）
  targetVolumeCount: integer().notNull(),          // 卷数（如 20）
  targetArcsPerVolume: integer().notNull(),        // 每卷弧数（如 4）
  pacingProfileMd: text().notNull(),               // '前 3 卷快节奏铺设定 / 中段慢热 / ...'
  forbiddenMd: text().default(''),                 // 主编明确禁的题材/桥段
  ...timestamps,
})
```

#### `volume_summaries` — 卷级蒸馏（与 `arcSummaries` 同构，高一级）

```ts
volumeSummaries = pgTable('volume_summaries', {
  id: uuid().primaryKey(),
  bookId: uuid().references(books).notNull(),
  volumeIdx: integer().notNull(),
  summaryMd: text().notNull(),
  pivotsMd: text().default(''),
  arcIdsCovered: uuid().array().notNull(),
  styleDriftNotesMd: text().default(''),           // 本卷写完后风格漂移观察
  generatedByRunId: uuid(),
  ...timestamps,
  unique('volume_summaries_book_idx_unique').on(t.bookId, t.volumeIdx),
})
```

### 2.2 改表

| 表 | 改动 | 原因 |
|---|---|---|
| `bookStates` | 删 `openThreads text[]` 字段 | 移到 `plot_threads` 表 |
| `bookStates` | 加 `volumeIdx`, `arcIdx` 整数字段 | 写章前快速定位"在第几卷第几弧" |
| `books` | 加 `currentVolumeIdx`, `currentArcIdx`, `currentChapterIdx` | 写指针 |
| `books` | 加 `gateMode` enum: `'manual' / 'auto-with-confirm' / 'fully-auto'` | smoke 跑 fully-auto，正式书跑 auto-with-confirm |
| `styleProfiles` | 加 `version`, `derivedFromChaptersMd`, `parentProfileId` | 滚动蒸馏的版本链 |
| `chapters` | 加 `gateApprovedBy enum('agent','human')`, `gateApprovedAt timestamp` | 单章 gate 留痕 |

### 2.3 数据模型总览（v2）

| 层 | 表 | 性质 |
|---|---|---|
| 复利知识库（不变） | elements / style_samples / style_profiles / hooks / anti_patterns | 长期沉淀 |
| 立项 | topic_cards / **topic_negotiations** / **book_briefs** | 一本书的入场参数 |
| 大纲 | **outline_nodes** / outline_revisions | 分层大纲 + 版本快照 |
| 业务实体 | books / characters / chapters / chapter_revisions | 单本书 |
| 状态 | book_states / **plot_threads** / **plot_thread_events** | 滚动状态 + 结构化伏笔 |
| 活文档 | world_rules / **book_docs** / **book_doc_kinds** / **book_doc_revisions** | 设定/关系/地图，可手编，分类可扩 |
| 蒸馏 | arc_summaries / **volume_summaries** | 章 → 弧 → 卷 |
| Prompt 仓 | **prompts** / **prompt_revisions** | 所有 agent 的 system + user 模板，可手编 |
| 观测（不变） | runs / llm_calls | 留痕 |

加粗 = v2 新增。

---

## 3. 工作台 UI（"文件树"语义）

### 3.1 路由结构

```
/books/$bookId                        # 重构成"工作台外壳"
├── /books/$bookId/dashboard          # 总览：进度、字数、待回收坑数、风格漂移信号
├── /books/$bookId/chat               # 立项/重谈：消息流 + 多候选卡
├── /books/$bookId/outline            # 分层大纲编辑：卷/弧/章节拍 三栏
├── /books/$bookId/files              # 文件树 + md 编辑器
│   ├── /tree                         # 树形导航
│   └── /$path                        # 单文件视图（按 path 路由）
├── /books/$bookId/chapters           # 章节列表 + 阅读模式
│   └── /$idx                         # 单章：阅读 / 修订对比 / 重新生成
├── /books/$bookId/threads            # 伏笔看板：open / hinted / paying / paid_off / abandoned
├── /books/$bookId/characters         # 角色卡列表
└── /books/$bookId/runs               # 本书的 run 树

# 全局菜单（不在 book 下）
/prompts                              # prompt 菜单：所有模板列表
└── /$slug                            # 单个 prompt 的编辑/版本/diff
/doc-kinds                            # book_docs 分类管理：看 AI 自创了哪些 kind
```

### 3.2 "文件树"长什么样

虚拟树，按"用户认知"组织（不是物理表结构）：

```
my-book/
├── 00-brief.md                       # ← book_briefs（结构化表单视图，可切 md 只读）
├── 01-outline/
│   ├── 卷1-启程篇.md                 # ← outline_nodes 卷级（render+编辑）
│   │   ├── 弧1-初入江湖.md
│   │   │   ├── ch001-投石问路.md     # ← chapters[idx=1]（点开进章节阅读模式）
│   │   │   └── ch002-...
│   │   └── 弧2-...
│   └── 卷2-...
├── 02-世界/
│   ├── 规则-修炼体系.md              # ← world_rules[kind='magic', slug='cultivation-system']
│   ├── 规则-地理.md
│   └── 设定-禁忌.md
├── 03-人物/
│   ├── 主角-林xx.md                  # ← characters[name='林xx']（结构化字段+md 描述）
│   └── 关系网.md                     # ← book_docs[kind='relations', slug='main']
├── 04-地图/
│   └── 主大陆.md                     # ← book_docs[kind='map', slug='main-continent']
├── 05-伏笔.md                        # ← plot_threads（自动 render，只读；编辑去 /threads 看板）
├── 06-时间线.md                      # ← book_docs[kind='timeline']
├── 07-风格指纹.md                    # ← style_profile（render，编辑触发新版本）
└── 99-主编笔记.md                    # ← book_docs[kind='reader_notes']
```

实现：路由 `/files/$path` 用一个 `resolveFileNode(bookId, path)` 服务函数，根据 path 模式返回 `{kind, source: row, renderer: 'md-edit' | 'form' | 'readonly-rendered'}`。

### 3.3 立项 chat（`/chat`）

- 左侧消息流，右侧"当前盘子"sticky 面板（book_brief 当前值）
- agent 回复可带 `candidates` 数组 → 渲染成卡片网格，用户勾选/否决/追加要求
- 每轮 agent 行为：读取 negotiation history + 当前 brief → 生成下一组候选或确认问题
- 用户点"确认立项" → 冻结 brief、生成 topic_card、触发 outline-architect 出全书卷级 + 第一卷弧级大纲

### 3.4 章节单页（`/chapters/$idx`）

四个 tab：
- **阅读** — 当前 final 版正文
- **修订** — chapter_revisions 时间轴 + 两版 diff
- **元信息** — 字数、guard 报告、关联伏笔事件、本章触发的 doc 更新
- **重新生成** — 改 prompt 提示 / 改大纲节拍 → 重跑 chapter-writer → 进入新一轮 gate

---

## 4. Agent 流（三道 gate）

### 4.1 立项 gate（gate-1）

```
chat → element 协商 → topic 候选 → brief 确认
                                       ↓
                       outline-architect（全书卷级 + 第一卷弧级）
                                       ↓
                        character-keeper（主要角色精细卡）
                                       ↓
                          world-keeper（从大纲提取硬规则）
                                       ↓
                              gate-1 ✋ 等人工确认
                                       ↓ 通过
                                进入"卷规划 gate"
```

`gateMode='fully-auto'` 时自动通过，不阻塞 smoke。

### 4.2 卷规划 gate（gate-2，每卷开始前）

```
进入新卷 → 读上一卷 volume_summary + 全书卷级大纲
        ↓
   outline-architect（出本卷的弧级 + 第一弧的章节拍）
        ↓
   plan-reviser（基于已写内容微调）
        ↓
        gate-2 ✋ 等人工确认
        ↓ 通过
       进入章节循环
```

### 4.3 章节循环 + 单章 gate（gate-3）

```
读 outline_node + 卷/弧/上章摘要 + book_state + 可回收坑清单
        ↓
   chapter-writer（含"是否回收 P0/P1 坑"强制问答）
        ↓
   consistency-guard（含 plot_threads 一致性校验）
        ↓
   hook-smith / style-polisher（可选）
        ↓
        gate-3 ✋ 等人工确认（默认开；smoke 关）
        ↓ 通过
   入库 chapters + chapter_revisions
        ↓
   章末蒸馏：
     - 更新 book_state（活角色、当前阶段、下章意图）
     - 更新 plot_threads（hinted/paying/paid_off 事件）
     - 更新 characters（新增/变更）
     - 更新 book_docs（map/relations 增量）
        ↓
   是弧末？→ arc-summarizer
   是卷末？→ volume-summarizer + style-distiller（滚动蒸馏） + 触发 gate-2 进入下一卷
```

### 4.4 收坑清单生成（写每章前注入 chapter-writer）

```sql
-- P0: 已超期
select * from plot_threads
where book_id = ? and status in ('open','hinted')
  and expected_payoff_end < :current_chapter

-- P1: 节奏高点（本章 pacingPhase in ('高潮','收尾') 或是弧末/卷末）
select * from plot_threads
where book_id = ? and status in ('open','hinted')
  and weight in ('arc','book')

-- P2: 触发条件可能满足（让 LLM 判定，不强查询）
-- 把所有 status='open' 的 thread 的 payoffTriggerMd + 本章意图喂给一个轻量 agent

-- P3: 存量压力
select count(*) from plot_threads
where book_id = ? and status = 'open'
-- 超过阈值（如 15）则提示"该还债"
```

prompt 里强制要求：
> 本章是否回收以下伏笔？请逐条回答 yes/no/postpone，no 必须说明理由：
> - [P0] thread-mysterious-letter（已超期 3 章）：...
> - [P1] thread-master-betrayal：...

### 4.5 章末自动 abandoned

每写完一章后：
```sql
update plot_threads
set status = 'abandoned',
    payoff_notes_md = '超过预期回收窗口（end=' || expected_payoff_end || '），自动作废'
where book_id = ? and status in ('open','hinted')
  and expected_payoff_end < :current_chapter - :grace_chapters  -- grace=5
```

---

## 5. 风格滚动蒸馏

每写完一卷触发：

```
读本卷所有章节正文（chapter_revisions 取最 final 的）
        ↓
style-distiller（new sample → 临时 profile）
        ↓
style-merger（新 agent，待加）：
   读 current style_profile + 临时 profile + volume_summary 的 styleDriftNotesMd
        ↓
   输出：merged_profile（加权融合，旧 0.6 / 新 0.4，可调）+ 漂移说明
        ↓
新增 style_profiles 行（version+1，parentProfileId 指向旧版），books.styleProfileId 指向新
```

**手动覆盖**：用户在 `/files/07-风格指纹.md` 编辑保存 → 直接当作新版本插入，跳过 merger。

---

## 6. 与 v1 的兼容点

| v1 行为 | v2 处理 |
|---|---|
| `produceBook(input)` 一次跑到底 | 拆成 `startBook()`（出 brief+大纲+gate-1）+ `runVolume()`（gate-2 + 章节循环 + gate-3）。`gateMode='fully-auto'` 时 wrap 一个 `produceBookFullAuto()` 顺序串起来，e2e smoke 仍可用 |
| `bookStates.openThreads: text[]` | 迁移：读现有数据，每条创建一个 `plot_threads` 行（weight 默认 `arc`，window 默认 `[introduced, introduced+10]`），删字段 |
| `outlineRevisions.chapterPlan` 单层 | 迁移：把现有数据转成 `outline_nodes`（全部 level='chapter'，parent=null）。新书走分层 |
| `world_rules` | 不动，照旧 |
| `arc_summaries` | 不动，加 `volume_summaries` 平行表 |

---

## 7. 实施顺序（小步迭代，每步可独立 ship）

| 步 | 内容 | 验收 |
|---|---|---|
| **S1** | 加 `plot_threads` + `plot_thread_events` 表 + 迁移 `bookStates.openThreads` | 现有 e2e smoke 仍跑通；伏笔从字符串变行 |
| **S2** | `chapter-writer` prompt 加"收坑清单"块；`consistency-guard` 校验伏笔事件 | smoke 跑出来的伏笔在表里有 introduce/hint 事件 |
| **S3** | 加 `outline_nodes` + 迁移；`outline-architect` 出分层结构（卷→弧→章节拍） | 新书的 outline 在 `outline_nodes` 表有三层 |
| **S4** | 加 `book_briefs` + `topic_negotiations`；`/books/$bookId/chat` 路由 | 能从 chat 立项一本书 |
| **S5** | 拆 `produceBook` 为 `startBook` + `runVolume`；加 `gateMode` 字段；smoke 用 fully-auto | smoke 不退化 |
| **S6** | 加 `book_docs` + `book_doc_revisions`；`/files` 路由 + 文件树 + md 编辑器 | 能在浏览器里编辑 map / relations |
| **S7** | 加 `volume_summaries` + style 滚动蒸馏 | 跑 50+ 章后能看到 style_profile 有多版本 |
| **S8** | gate-1/2/3 真·暂停（pg-boss 任务挂起 + 网页确认按钮） | 默认开 gate 模式下，能在 UI 点确认 |
| **S0**（穿插） | 加 `prompts` + `prompt_revisions` 表，把现有 SYSTEM/builder 函数全迁进去；`/prompts` 路由 | 所有 agent 调用都走 `loadPrompt()` / `renderPrompt()` |

**实施时机**：S0 不是真正的"第 0 步"，而是"S1-S8 的每一步如果改动了某个 agent 的 prompt，就顺手把那个 prompt 迁进 `prompts` 表"。这样 S0 自然在 S1-S8 进行中渐进完成，避免一次性大迁移。**完成条件**：S8 结束时 `app/server/mastra/agents/*.ts` 里的 `SYSTEM` 常量和 `book-producer.ts` 里的 `xxxPrompt()` 函数都已清空，全在表里。

S1-S3 是数据层硬骨头，做完长程一致性就到位。S4-S6 是 UX 层。S7-S8 是收尾。

---

## 8. 已决技术细节（不再开放）

按"技术问题你自己决定"原则，把上一版的开放问题全部敲定：

1. **gate-3 暂停**：pg-boss 任务进 `awaiting-gate` 状态 + UI 用 server-fn polling（每 3-5s 拉 `gateRequests` 表）。不引入 websocket，简单可靠，符合"够用就行"。
2. **outline_nodes 改动后已写章节**：标 `outline_node.status = 'revised'`，**不动 chapter 正文**（符合 P3 只前向）。UI 在大纲页给被改的节点加视觉提示，让用户决定要不要手动重新生成对应章节。
3. **book_docs 的 markdown 是否要锚点**：**不要**（符合 P7）。agent 整篇读 + 整篇覆盖，靠 `book_doc_revisions` 留 diff。这也意味着 agent 改 doc 时必须读原文 → 改 → 全文回写，不做局部 patch。
4. **角色卡结构化 vs md**：保留 `characters.name / role` 等结构化列（plot_threads / outline_nodes 要外键引角色，必须能 join），`cardMd` 完全自由不限格式。这不是把 md "拆字段"，而是结构化字段和 md 字段并存。
5. **prompt 模板引擎**：用最朴素的 `{{var}}` 字符串替换，不上 Handlebars / Mustache 完整语法。复杂结构（如"角色列表渲染成 bullet"）在 TS 端预格式化成字符串再注入。理由：prompt 模板是给人编辑的，越接近"普通文本+几个占位符"越好。

---

## 9. 增量与迁移要点

迁移脚本（drizzle migration）顺序：
1. `add table plot_threads / plot_thread_events`
2. data migration：`bookStates.openThreads` → 行
3. `alter table bookStates drop column openThreads`
4. `add table outline_nodes`
5. data migration：`outlineRevisions[latest].chapterPlan` → outline_nodes(level='chapter')
6. `add table book_briefs / topic_negotiations`
7. `alter table books add column gateMode default 'fully-auto'`（保证现有路径不变）
8. `add table book_doc_kinds`（先建 kind 表）+ seed 6 个预置 kind
9. `add table book_docs / book_doc_revisions`
10. `add table volume_summaries`
11. `alter table styleProfiles add column version, parentProfileId, derivedFromChaptersMd`
12. `add table prompts / prompt_revisions` + seed 现有所有 SYSTEM 与 builder 模板

每一步独立 commit + drizzle 迁移文件 + 一个 vitest 验证迁移正确。

**未来项**（不在本次 v2 内，留笔）：`worldRules.kind` 由 pgEnum 改成 text + lookup（与 P8 对齐）。本期不动是因为现有数据已经填了 enum 值，改动面与收益不匹配。

---

## 10. Prompt 菜单

### 10.1 表设计

```ts
prompts = pgTable('prompts', {
  slug: text().primaryKey(),                       // 'consistency-guard.system' / 'chapter-writer.user'
  agentId: text().notNull(),                       // 'consistency-guard'
  role: pgEnum('prompt_role', ['system', 'user']).notNull(),
  title: text().notNull(),                         // '一致性守门员 - 系统提示'
  templateMd: text().notNull(),                    // 含 {{var}} 占位符
  variables: jsonb().$type<Array<{
    name: string;
    description: string;
    example?: string;
  }>>().notNull().default([]),                     // 模板变量自描述，UI 编辑器用
  notesMd: text().default(''),                     // 设计意图、踩坑笔记
  version: integer().notNull().default(1),
  isActive: boolean().notNull().default(true),     // 同 slug 只允许一个 active
  ...timestamps,
})

promptRevisions = pgTable('prompt_revisions', {
  id: uuid().primaryKey(),
  slug: text().notNull(),
  version: integer().notNull(),
  templateMd: text().notNull(),
  editedBy: pgEnum('doc_editor', ['agent', 'human']).notNull(),
  reasonMd: text().default(''),
  ...timestamps,
  unique('prompt_revisions_slug_version_unique').on(t.slug, t.version),
})
```

### 10.2 命名规范

`<agent-id>.<role>` 或 `<agent-id>.<role>.<variant>`：
- `consistency-guard.system`
- `chapter-writer.system`
- `chapter-writer.user`（书写每章的 user 模板）
- `chapter-writer.user.rewrite`（被 guard 拒后重写时的变体）
- `topic-scout.system.candidate-gen`（生成多候选时）
- `outline-architect.user.volume-plan`（出卷级大纲）

### 10.3 调用 API

```ts
// app/server/prompts/registry.ts
export async function loadPrompt(slug: string): Promise<string> {
  // 取 isActive=true 的当前版本
}

export async function renderPrompt(
  slug: string,
  vars: Record<string, string>,
): Promise<string> {
  const tpl = await loadPrompt(slug);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}
```

agent 文件改动示例（`consistency-guard.ts`）：
```ts
// 旧
const SYSTEM = `你是「一致性守门员」...`;
export const consistencyGuard = new Agent({ instructions: SYSTEM, ... });

// 新
export async function makeConsistencyGuard() {
  const instructions = await loadPrompt('consistency-guard.system');
  return new Agent({ instructions, ... });
}
// 调用方在每次需要时 `const guard = await makeConsistencyGuard()`
// 缓存策略：用 LRU + slug.version 作 key，编辑后自动失效
```

`book-producer.ts` 里的 builder（`chapterWriterPrompt(opts)`）改成：
```ts
const userPrompt = await renderPrompt('chapter-writer.user', {
  outlineTitle: opts.outlineDraft.title,
  charactersList: formatCharacters(opts.outlineDraft.characters),  // TS 端预格式化
  prevState: stateToContext(opts.prevState),
  // ...
});
```

### 10.4 UI（`/prompts`）

- 列表页：按 agentId 分组，每行显示 `slug | title | role | version | 最后编辑时间 | 编辑者`
- 编辑页：左侧 Monaco/CodeMirror md 编辑器，右侧 sticky "可用变量"清单（取自 `variables` 字段）
- 保存：写新版 + 标旧版 inactive；可一键回滚
- diff 视图：选两个 version 对比

### 10.5 与 prompt 自动测试

每个 prompt 旁路一个 `prompt_smoke_inputs` 字段（jsonb，存一组示例 vars）。编辑保存时自动渲染一遍 + 跑一次 mock LLM 调用，确认输出能被 zod schema 解析。失败则警告但允许保存（人类决定要不要 ship）。

### 10.6 为什么不放磁盘 md 文件

- `app/server/prompts/<skill>.md` 是 AGENTS.md 里写的 v1 计划，但从没真正落地
- 落到 PG 的好处：版本/编辑者/diff 都自动有；UI 能直接编辑；不用每次部署重启
- 缺点：失去 git diff —— 用 `prompt_revisions` 表 + 必要时导出脚本补上

---

**实现已完成。下面是设计原文存档 + §11 follow-up 清单。**

---

## 11. Follow-up 清单（v2 之后）

按收益高低排：

### 高价值
- **gate-2 / gate-3 真实暂停**：service 模板就绪，缺触发点。需要 producer 拆出 `runVolume` 概念（卷边界 → gate-2）+ 单章 gate-3 hook
- **finalizeVolume 自动化**：S7 的卷蒸馏 + 风格 merge 服务已就，需要 producer 知道何时 "卷写完了"。当前要手动调
- **outline_nodes 读侧驱动**：chapter loop 切到读 outline_nodes 树（按卷/弧推进），supports 后续按卷重规划

### 中价值
- **剩余 7 个 agent 切 prompts 表**：character-keeper / hook-smith / style-tweaker / style-polisher / world-keeper / arc-summarizer / plan-reviser / element-curator。模板待 seed
- **prompt smoke test**：保存 prompt 时跑一次 mock 调用确认输出仍能被 zod 解析
- **gate UI polling**：当前要手动刷新书页才能看到新出现的 gate（如 chat 流的 gate-1 在后台 outline-architect 跑完才出）。3-5s polling
- **worldRules.kind enum → text + lookup**：与 P8 对齐，现状不痛但 v2 之外的 agent 想自创 kind 时被卡

### 低价值
- **doc-kinds 管理页**：当前 /books/$bookId/files 按 kind 分组已经能看到全部 kind，覆盖度够
- **chat 流定向到已确认 candidate 的回退**：现 confirmTopic 等 outline-architect 5-15s 同步；如果用户中途关页面，next time 需手动重新触发
- **prompt 模板有 LRU 缓存**：每次 agent 调用都查 DB（一行小数据）；高频时可加缓存按 slug.version 失效

### v1 继承
- topic-scout 数据回流（平台追读率）做评分校准
- chapter-writer 接入 arc/卷摘要做长上下文压缩
- world-keeper 跟 consistency-guard 闭环
- pgvector 语义召回（按需）
