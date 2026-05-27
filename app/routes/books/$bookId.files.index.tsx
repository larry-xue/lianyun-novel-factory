import { createFileRoute, Link } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { listDocsForBookFn } from '~/server/fns/book-docs';

export const Route = createFileRoute('/books/$bookId/files/')({
  component: FilesIndex,
  loader: async ({ params }) => {
    const r = await listDocsForBookFn({ data: { bookId: params.bookId } });
    return { bookId: params.bookId, docs: r.docs };
  },
});

function FilesIndex() {
  const { bookId, docs } = Route.useLoaderData();
  // 取最近编辑的 6 份给一个"快捷入口"列表
  const recent = [...docs]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="text-base font-semibold">vault</h2>
        <p className="mt-0.5 text-xs text-(--color-muted)">
          从左侧文件树选一份文档；或从下面最近编辑的快捷入口打开。
        </p>
      </header>

      {recent.length === 0 ? (
        <p className="text-xs text-(--color-muted) italic">
          这本书还没有活文档。立项 design phase 跑完会自动产出 character/world/style/relations 等。
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wide text-(--color-muted)">
            最近编辑
          </div>
          {recent.map((d) => (
            <Link
              key={d.id}
              to="/books/$bookId/files/$kind/$"
              params={{ bookId, kind: d.kind, _splat: d.slug }}
              className="flex items-center gap-2 rounded border border-(--color-border) px-2 py-1.5 text-xs hover:bg-(--color-surface)"
            >
              <FileText className="h-3 w-3 shrink-0 text-(--color-muted)" />
              <span className="truncate font-medium">{d.title}</span>
              <code className="text-[10px] text-(--color-muted) shrink-0 ml-auto">
                {d.kind}/{d.slug}.md · v{d.version}
              </code>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
