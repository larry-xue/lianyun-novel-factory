# 炼云小说工厂

简体中文 | [English](README.en.md)

炼云小说工厂是一个开源的 AI 长篇网文生产工作台。它把 Web UI、Agent 工作流、提示词管理、长篇设定文档、批量任务和运行追踪放在一个本地优先的应用里，帮助作者和工具开发者更透明地设计、生成、审阅和迭代长篇小说。

这个项目的目标不是自动发布内容，而是提供一个可观察、可调试、可替换内核的创作系统。V0.1 先把小说生产流程、数据库结构和前端工作台开源出来；后续版本会继续收敛内核边界，并尝试接入 Pi Agent。

## 当前状态

当前版本是 **v0.1.0**。

V0.1 的运行内核基于 Mastra 风格的 agents 和本地 harness services。它已经包含选题、故事设计、章节规划、章节生成、质量检查、活文档维护、批量生产和运行追踪等基础能力。

计划中的 **v0.2** 会评估把核心 agent loop 替换成 Pi Agent，同时尽量保留现有的 Web 工作台、数据库表结构和运行追踪界面。

## 功能

- 小说工作台：管理选题、书籍、章节、风格样本、hook、反模式和生产状态。
- 多步骤 Agent 流程：支持故事设计、章节规划、章节写作、质量检查和维护总结。
- 活文档：维护角色、世界规则、关系、设定、里程碑和文风说明。
- 提示词仓库：内置系统提示词和片段，并支持版本化编辑。
- 运行追踪：用 PostgreSQL 记录 LLM 调用、工具调用、运行事件和调试信息。
- 批量生产：通过 pg-boss 管理批量任务队列。
- 模型接入：支持 OpenAI-compatible endpoint，可通过 `.env` 或设置页配置。
- 本地 TXT 风格样本导入：只处理用户选择的本地文件。

## 技术栈

- TanStack Start
- React
- Drizzle ORM
- PostgreSQL 16 / pgvector Docker image
- Mastra
- pg-boss
- Vitest
- pnpm

## 快速开始

环境要求：

- Node.js 22+
- pnpm 10.6+
- Docker with Compose

```bash
pnpm install
pnpm db:up
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

默认情况下，Web 应用会运行在 `http://localhost:3000`。

创建管理员账号：

```bash
pnpm tsx scripts/create-user.ts <username> <password> admin
```

## 配置

`.env.example` 提供了本地默认配置。

```bash
LLM_API_ENDPOINT=https://api.openai.com/v1
LLM_API_KEY=replace-me
LLM_MODEL=gpt-4o-mini
DATABASE_URL=postgresql://lianyun:lianyun_dev@localhost:5433/lianyun
BATCH_CONCURRENCY=2
```

`LLM_API_ENDPOINT` 需要是 OpenAI-compatible endpoint。不要把真实 API key 提交到仓库。

## 常用脚本

```bash
pnpm dev          # 启动 TanStack 应用
pnpm mastra:dev   # 启动 Mastra DevTools
pnpm typecheck    # TypeScript 类型检查
pnpm test         # 运行 Vitest 测试
pnpm check        # typecheck + test
pnpm db:up        # 启动本地 Postgres
pnpm db:migrate   # 执行数据库迁移
pnpm db:seed      # 写入提示词和元素种子数据
pnpm db:reset     # 重置本地数据库卷并重新 seed
```

## 项目结构

- `app/routes/`：TanStack Start 页面路由
- `app/server/db/`：Drizzle schema 和数据库客户端
- `app/server/services/`：生产流水线、运行追踪、闸门、提示词和领域服务
- `app/server/prompts/`：系统提示词和提示词片段
- `app/server/mastra/`：Mastra agent 注册
- `scripts/seed/`：种子数据
- `drizzle/migrations/`：数据库迁移 SQL
- `docs/`：架构说明和实现决策记录

## 内容与版权边界

本项目不包含受版权保护的小说正文样本，也不提供下载、爬取、DRM 绕过、付费内容绕过或平台自动化能力。

如果你导入风格样本，请只使用你自己创作、拥有版权、合法生成，或已经获得授权处理的内容。TXT 导入器只读取用户选择的本地文件，不会自动上传、下载或抓取外部内容。

AI 生成的小说内容仍然需要人工审阅，尤其是原创性、安全性、平台合规和发布权利。

## 路线图

- v0.1.x：稳定当前 Mastra/harness 流程，补充公开文档和开发说明。
- v0.2：评估用 Pi Agent 替换运行内核，同时保留现有 Web 工作台和数据库边界。
- 后续：沙箱化 agent 执行、更完整的 replay UI、可导出的 story packs、插件式提示词/agent packs。

## 许可证

MIT
