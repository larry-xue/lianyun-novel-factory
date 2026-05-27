import Markdown from 'react-markdown';
import { MermaidBlock } from '~/components/mermaid-block';

export function MarkdownView({ children }: { children: string }) {
  return (
    <Markdown
      components={{
        h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mt-2.5 mb-1">{children}</h3>,
        p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-(--color-accent) pl-3 my-2 italic text-(--color-muted)">
            {children}
          </blockquote>
        ),
        pre: ({ children }) => {
          const child = Array.isArray(children) ? children[0] : children;
          const props = (child as { props?: { className?: string; children?: unknown } } | undefined)?.props;
          const className = props?.className ?? '';
          const raw = String(props?.children ?? '').replace(/\n$/, '');
          if (className.includes('language-mermaid')) {
            return <MermaidBlock code={raw} />;
          }
          return (
            <pre className="rounded-md bg-(--color-bg) p-3 my-2 overflow-x-auto text-[11px]">
              <code>{raw}</code>
            </pre>
          );
        },
        code: ({ children, className }) => {
          if (!className?.includes('language-')) {
            return <code className="rounded bg-(--color-bg) px-1 py-0.5 text-[11px]">{children}</code>;
          }
          return <>{children}</>;
        },
        table: ({ children }) => (
          <table className="w-full border-collapse my-2 text-[11px]">{children}</table>
        ),
        th: ({ children }) => (
          <th className="border border-(--color-border) px-2 py-1 bg-(--color-surface) text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-(--color-border) px-2 py-1">{children}</td>
        ),
        hr: () => <hr className="my-3 border-(--color-border)" />,
        a: ({ href, children }) => (
          <a href={href} className="text-(--color-accent) hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {children}
    </Markdown>
  );
}
