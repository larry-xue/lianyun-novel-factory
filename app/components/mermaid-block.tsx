import { useEffect, useId, useRef, useState } from 'react';

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const reactId = useId();
  const id = `mermaid-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : '渲染失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (err) {
    return (
      <pre className="rounded-md border border-red-300 bg-red-50 p-3 my-2 text-[11px] text-red-700 whitespace-pre-wrap">
        {`mermaid 渲染失败：${err}\n\n${code}`}
      </pre>
    );
  }
  return <div ref={ref} className="my-2 flex justify-center overflow-auto" />;
}
