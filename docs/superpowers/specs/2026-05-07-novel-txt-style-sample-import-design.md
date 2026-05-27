# Novel TXT 范文导入设计

## 背景

用户希望把自己拥有版权、已获授权或可合法处理的本地小说 TXT 文件导入范文库，用于后续风格蒸馏。

本项目不集成下载/API 逻辑，也不提供绕过登录、付费、DRM、验证码、反爬或批量抓取能力。边界是：用户自行选择一份有权处理的本地 TXT 文件，本项目只负责读取本地文件、清洗为范文素材、写入 `style_samples`。

## 目标

- 在 `/styles/samples` 增加“导入 Novel TXT”入口。
- 用户选择本地 `.txt` 文件后，浏览器端读取内容并解析元信息。
- 一次导入生成一条 `style_samples` 记录。
- 风格蒸馏时使用范文全文，不再截断到 2400 字。
- 保留人工确认步骤，入库前用户可以修改作者、标题、标签、来源和正文。

## 非目标

- 不在后端启动、调用或嵌入任何下载器。
- 不实现目录扫描、文件 watcher 或自动入库。
- 不支持账号登录、VIP/付费章节绕过、验证码处理或反爬规避。
- 不把整本书拆成多条范文；本阶段固定“一次 TXT 导入 = 一条范文”。
- 不对正文做改写、摘要、抽样或截断。

## 推荐工作流

1. 用户准备一份自己有权处理的 TXT 单文件。
2. 打开本项目 `/styles/samples`。
3. 在“导入 Novel TXT”中选择本地 `.txt` 文件。
4. 页面解析 TXT 并预填作者、标题、标签、来源、正文。
5. 用户确认或调整后点击“添加”。
6. 范文写入 `style_samples`。
7. 在 `/styles/profiles` 选择这条范文蒸馏风格指纹。

## UI 设计

`/styles/samples` 保持现有“添加范文”表单，并在表单顶部加入一个 TXT 文件导入控件。

导入控件行为：

- 只接受 `.txt`。
- 文件读取在浏览器端完成，不新增文件上传存储。
- 成功解析后填充现有表单字段。
- 如果解析失败，给出轻量错误提示，用户仍可手动粘贴。
- 导入不会自动入库，必须用户点击“添加”。

字段预填规则：

- `author`: TXT 元信息里的作者；缺失时填 `未知作者`。
- `title`: 书名；如果识别出章节数，标题使用 `书名 · 前 N 章`。如果章节不是从第 1 章开始，使用 `书名 · 第 A-B 章`。
- `tags`: 自动添加 `novel-txt`、`前N章`，有 `book_id` 时添加 `book_id:<id>`。
- `sourceUrl`: 有 `book_id` 时填 `novel://book/<book_id>`；没有则留空。
- `contentMd`: 清洗后的全文。

## TXT 解析与清洗

新增一个纯函数模块，例如 `app/lib/novel-txt-import.ts`，用于前端和测试复用。

建议导出：

```ts
interface NovelTxtImportResult {
  author: string;
  title: string;
  tags: string[];
  sourceUrl?: string;
  contentMd: string;
  meta: {
    bookTitle?: string;
    author?: string;
    bookId?: string;
    chapterStart?: number;
    chapterEnd?: number;
    chapterCount?: number;
  };
}

function parseNovelTxt(content: string, filename?: string): NovelTxtImportResult;
```

清洗规则：

- 统一换行：`\r\n` / `\r` 转为 `\n`。
- 去掉 UTF-8 BOM。
- 识别并移除顶部元信息块：`书名：`、`作者：`、`book_id=`、`状态：`、`评分：`、`字数：`、`章节：`、`分类：`、`标签：`、`在读：`、`简介：` 以及简介正文。
- 移除明显分隔线：连续 8 个以上 `=` 或 `-`。
- 保留章节标题和正文段落。
- 合并过多空行：3 个以上空行压成 2 个。
- 不改写正文语句，不删除疑似正文内容。

章节识别：

- 优先匹配行首：`第...章`、`第...回`、`第...节`。
- 支持阿拉伯数字和常见中文数字。
- 能识别章节数时生成 `前N章` 标签。
- 识别不到章节也允许导入，以文件名或 `未知作品` 作为标题兜底。

## 数据流

```mermaid
flowchart LR
  A[用户准备合法本地 TXT] --> B[用户在范文库选择本地 TXT]
  B --> C[浏览器 FileReader 读取文本]
  C --> D[parseNovelTxt 清洗和解析]
  D --> E[预填现有添加范文表单]
  E --> F[用户确认]
  F --> G[createStyleSampleFn]
  G --> H[(style_samples)]
  H --> I[distillStyleProfile]
  I --> J[(style_profiles)]
```

## 风格蒸馏变更

当前 `app/server/services/style-profile.ts` 会对每条范文调用 `truncateForPrompt(s.contentMd, 2400)`。本设计要求改为直接写入 `s.contentMd` 全文。

变更后：

- `distillStyleProfile` 仍支持 1-10 条 `style_samples`。
- 每条样本完整进入 prompt。
- 删除仅供该路径使用的 `truncateForPrompt` helper。
- 不增加自动截断、抽样或压缩逻辑。

风险与约束：

- 依赖当前 LLM 配置具有足够上下文窗口。
- 如果后续切换到小上下文模型，蒸馏调用可能失败；这是配置问题，不在本阶段做自动降级。

## 错误处理

- 文件不是 `.txt`：前端提示“请选择 TXT 文件”。
- 文件读取失败：前端显示错误，保留手动输入能力。
- 无法解析元信息：使用文件名和默认作者兜底。
- 清洗后正文不足 40 字：沿用 `createStyleSampleFn` 的校验失败提示。
- 入库失败：沿用现有错误展示。

## 测试

新增 focused Vitest：

- `parseNovelTxt` 能解析 通用小说 TXT 的书名、作者、book_id。
- `parseNovelTxt` 能去除顶部元信息和分隔线，保留章节标题与正文。
- `parseNovelTxt` 能根据前 10 章生成 `书名 · 前 10 章` 和 `前10章` 标签。
- `distillStyleProfile` prompt 构造不再包含 `已截断`，并包含完整长样本文本。

## 文件范围

预计改动：

- `app/lib/novel-txt-import.ts`
- `app/lib/novel-txt-import.test.ts`
- `app/routes/styles/samples/index.tsx`
- `app/server/services/style-profile.ts`
- `app/server/services/style-profile.test.ts`

不改动：

- `style_samples` 表结构。
- 下载器、抓取器或外部内容获取逻辑。
- 后端文件上传/存储。
