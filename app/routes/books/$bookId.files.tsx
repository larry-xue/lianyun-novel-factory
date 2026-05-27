import { createFileRoute, Link, Outlet, useMatches, useRouter } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
} from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { listDocsForBookFn, saveDocFn } from '~/server/fns/book-docs';

export const Route = createFileRoute('/books/$bookId/files')({
  component: FilesLayout,
  loader: async ({ params }) => {
    const r = await listDocsForBookFn({ data: { bookId: params.bookId } });
    return { bookId: params.bookId, ...r };
  },
});

interface DocLeaf {
  kind: string;
  slug: string;
  title: string;
  version: number;
  lastEditedBy: string;
}

interface TreeNode {
  /** 仅"路径段"。文件用 doc 标识本身。 */
  segment: string;
  /** 是文件还是目录。文件叶子带 doc。 */
  doc?: DocLeaf;
  children: TreeNode[];
}

/**
 * 把同 kind 下的 docs 按 slug 用 "/" 切分成嵌套树。
 * 例：character/lin-an + character/su-ya → 单层
 *     world/factions/tianhua + world/factions/luoshui + world/setting →
 *       factions/ {tianhua, luoshui}; setting
 */
function buildKindTree(docs: DocLeaf[]): TreeNode[] {
  const root: TreeNode = { segment: '', children: [] };
  for (const doc of docs) {
    const segments = doc.slug.split('/');
    let cur = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const isLeaf = i === segments.length - 1;
      let next = cur.children.find((c) => c.segment === seg && !c.doc === !isLeaf);
      if (!next) {
        next = isLeaf ? { segment: seg, doc, children: [] } : { segment: seg, children: [] };
        cur.children.push(next);
      }
      cur = next;
    }
  }
  // 排序：目录在前，再字母序
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (!!a.doc !== !!b.doc) return a.doc ? 1 : -1;
      return a.segment.localeCompare(b.segment);
    });
    for (const c of n.children) sortRec(c);
  };
  sortRec(root);
  return root.children;
}

function FilesLayout() {
  const { bookId, docs, kinds } = Route.useLoaderData();
  const matches = useMatches();
  const router = useRouter();

  // 当前选中的 doc 路径（kind/slug）：从子路由 params 推出
  const activePath = useMemo(() => {
    for (const m of matches) {
      const p = m.params as { kind?: string; _splat?: string };
      if (p.kind && p._splat !== undefined) return `${p.kind}/${p._splat}`;
    }
    return null;
  }, [matches]);

  // 给每个 kind 加 zh 名 + 描述
  const kindMeta = useMemo(() => {
    const m = new Map<string, { zh: string; descriptionMd: string; introducedBy: string }>();
    for (const k of kinds) m.set(k.slug, k);
    return m;
  }, [kinds]);

  // 按 kind 分桶
  const byKind = useMemo(() => {
    const m = new Map<string, DocLeaf[]>();
    for (const d of docs) {
      const arr = m.get(d.kind) ?? [];
      arr.push(d);
      m.set(d.kind, arr);
    }
    return m;
  }, [docs]);

  // 可见 kind 顺序：先有 doc 的 kind（按 zh），再空 kind
  const visibleKinds = useMemo(() => {
    const populated = [...byKind.keys()].sort((a, b) => {
      const za = kindMeta.get(a)?.zh ?? a;
      const zb = kindMeta.get(b)?.zh ?? b;
      return za.localeCompare(zb);
    });
    const empty = kinds
      .map((k) => k.slug)
      .filter((s) => !byKind.has(s))
      .sort();
    return [...populated, ...empty];
  }, [byKind, kinds, kindMeta]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link
          to="/books/$bookId"
          params={{ bookId }}
          className="inline-flex items-center gap-1 text-sm text-(--color-muted) hover:text-(--color-fg)"
        >
          <ArrowLeft className="h-4 w-4" /> 返回书页
        </Link>
        <span className="text-[10px] text-(--color-muted)">
          {docs.length} 个文档 · {kinds.length} 个分类
        </span>
      </div>

      <header>
        <h1 className="text-xl font-semibold tracking-tight">文件树</h1>
        <p className="mt-0.5 text-xs text-(--color-muted)">
          按 kind 分组的 vault 活文档；slug 含 / 的会展开成嵌套目录。左侧选文件，右侧编辑。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
        {/* ── 左侧文件树 ── */}
        <aside className="rounded-md border border-(--color-border) bg-(--color-surface) p-2">
          <div className="flex flex-col gap-0.5 max-h-[calc(100vh-220px)] overflow-y-auto">
            {visibleKinds.map((kindSlug) => {
              const kindDocs = byKind.get(kindSlug) ?? [];
              const meta = kindMeta.get(kindSlug);
              return (
                <KindGroup
                  key={kindSlug}
                  bookId={bookId}
                  kindSlug={kindSlug}
                  zh={meta?.zh ?? kindSlug}
                  docs={kindDocs}
                  activePath={activePath}
                  onCreated={() => router.invalidate()}
                />
              );
            })}
          </div>
        </aside>

        {/* ── 右侧内容区（子路由 outlet） ── */}
        <section className="rounded-md border border-(--color-border) bg-(--color-bg) p-4 min-h-[calc(100vh-220px)]">
          <Outlet />
        </section>
      </div>
    </div>
  );
}

/* ───── 一个 kind 节点：可折叠 + 可创建 ───── */
function KindGroup(props: {
  bookId: string;
  kindSlug: string;
  zh: string;
  docs: DocLeaf[];
  activePath: string | null;
  onCreated: () => void;
}) {
  const { bookId, kindSlug, zh, docs, activePath, onCreated } = props;
  const tree = useMemo(() => buildKindTree(docs), [docs]);

  const hasActive = activePath?.startsWith(`${kindSlug}/`);
  const [open, setOpen] = useState<boolean>(hasActive || docs.length > 0);
  const [creating, setCreating] = useState(false);

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between rounded px-1.5 py-1 hover:bg-(--color-bg)/40 group">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 flex-1 min-w-0 text-left"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-(--color-muted)" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-(--color-muted)" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-(--color-muted)" />
          )}
          <span className="font-medium truncate">{zh}</span>
          <code className="text-[10px] text-(--color-muted) shrink-0">{kindSlug}</code>
          {docs.length > 0 && (
            <span className="text-[9px] text-(--color-muted) ml-auto pr-1">{docs.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating((v) => !v);
            setOpen(true);
          }}
          className="opacity-0 group-hover:opacity-100 rounded p-0.5 hover:bg-(--color-accent)/10"
          title={`在 ${kindSlug} 下新建`}
        >
          <FilePlus className="h-3 w-3 text-(--color-muted)" />
        </button>
      </div>
      {open && (
        <div className="ml-3 border-l border-(--color-border) pl-1.5 mt-0.5">
          {tree.length === 0 && !creating && (
            <span className="block py-0.5 italic text-(--color-muted)">（暂无）</span>
          )}
          {tree.map((node, idx) => (
            <TreeNodeRow
              key={`${kindSlug}/${node.segment}/${idx}`}
              bookId={bookId}
              kindSlug={kindSlug}
              node={node}
              prefix=""
              activePath={activePath}
            />
          ))}
          {creating && (
            <CreateForm
              bookId={bookId}
              kindSlug={kindSlug}
              onDone={() => {
                setCreating(false);
                onCreated();
              }}
              onCancel={() => setCreating(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ───── 单个 tree node：递归渲染 ───── */
function TreeNodeRow(props: {
  bookId: string;
  kindSlug: string;
  node: TreeNode;
  prefix: string;
  activePath: string | null;
}) {
  const { bookId, kindSlug, node, prefix, activePath } = props;
  const fullSlug = prefix ? `${prefix}/${node.segment}` : node.segment;
  const fullPath = `${kindSlug}/${fullSlug}`;

  if (node.doc) {
    const isActive = activePath === fullPath;
    return (
      <Link
        to="/books/$bookId/files/$kind/$"
        params={{ bookId, kind: kindSlug, _splat: fullSlug }}
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-(--color-bg)/40 ${
          isActive ? 'bg-(--color-accent)/10 text-(--color-accent)' : ''
        }`}
      >
        <FileText className="h-3 w-3 shrink-0 text-(--color-muted)" />
        <span className="truncate">{node.doc.title}</span>
        <code className="text-[9px] text-(--color-muted) shrink-0 ml-auto">
          v{node.doc.version}
        </code>
      </Link>
    );
  }

  // 目录节点
  return <DirectoryNode {...props} fullSlug={fullSlug} />;
}

function DirectoryNode(props: {
  bookId: string;
  kindSlug: string;
  node: TreeNode;
  prefix: string;
  fullSlug: string;
  activePath: string | null;
}) {
  const { bookId, kindSlug, node, fullSlug, activePath } = props;
  const fullPath = `${kindSlug}/${fullSlug}`;
  const containsActive = activePath?.startsWith(`${fullPath}/`);
  const [open, setOpen] = useState<boolean>(!!containsActive);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-(--color-bg)/40 w-full text-left"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-(--color-muted)" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-(--color-muted)" />
        )}
        {open ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-(--color-muted)" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-(--color-muted)" />
        )}
        <span className="truncate">{node.segment}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-(--color-border) pl-1.5">
          {node.children.map((child, idx) => (
            <TreeNodeRow
              key={`${fullSlug}/${child.segment}/${idx}`}
              bookId={bookId}
              kindSlug={kindSlug}
              node={child}
              prefix={fullSlug}
              activePath={activePath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───── 行内创建表单 ───── */
function CreateForm(props: {
  bookId: string;
  kindSlug: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { bookId, kindSlug, onDone, onCancel } = props;
  const router = useRouter();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    const s = slug.trim().toLowerCase();
    const t = title.trim();
    if (!s || !t) return;
    setBusy(true);
    setErr(null);
    try {
      await saveDocFn({
        data: {
          bookId,
          kind: kindSlug,
          slug: s,
          title: t,
          contentMd: `# ${t}\n\n（在此开始撰写）\n`,
          reasonMd: '新建',
        },
      });
      onDone();
      router.navigate({
        to: '/books/$bookId/files/$kind/$',
        params: { bookId, kind: kindSlug, _splat: s },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-1 flex flex-col gap-1 rounded border border-(--color-border) bg-(--color-surface) p-1.5">
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px]">slug（支持 / 多级，如 factions/tianhua-zong）</Label>
        <Input
          value={slug}
          placeholder="lin-an 或 factions/tianhua-zong"
          onChange={(e) => setSlug(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <Label className="text-[10px]">标题</Label>
        <Input
          value={title}
          placeholder="如：林岸 · 角色卡"
          onChange={(e) => setTitle(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      {err && <span className="text-[10px] text-red-600">{err}</span>}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="accent"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={go}
          disabled={busy || !slug.trim() || !title.trim()}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          创建
        </Button>
      </div>
    </div>
  );
}
