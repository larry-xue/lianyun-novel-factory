import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from '@tanstack/react-router';
import { Compass, Menu } from 'lucide-react';
import { useState } from 'react';
import { ErrorScreen } from '~/components/layout/error-screen';
import { MobileSidebar, Sidebar } from '~/components/layout/sidebar';
import { fetchMeFn } from '~/server/fns/auth';
import globalsCss from '~/styles/globals.css?url';

export interface RootContextUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: '炼云小说工厂' },
    ],
    links: [{ rel: 'stylesheet', href: globalsCss }],
  }),
  beforeLoad: async ({ location }) => {
    const me = await fetchMeFn();
    const onLogin = location.pathname === '/login' || location.pathname.startsWith('/login/');
    if (!me && !onLogin) {
      throw redirect({ to: '/login' });
    }
    return { me: me as RootContextUser | null };
  },
  notFoundComponent: NotFoundPage,
  component: RootDocument,
});

function NotFoundPage() {
  return (
    <ErrorScreen
      code="404"
      title="页面走丢了"
      icon={<Compass className="h-7 w-7" />}
      tone="amber"
      description={
        <>
          你访问的页面不存在，可能是 URL 拼错了，或这本书 / 这个文档已经被删除。
        </>
      }
      secondaryAction={{ label: '去书架', to: '/books' }}
      hint="如果是从外部链接进来，请告诉链接的提供方更新一下。"
    />
  );
}

function RootDocument() {
  const { me } = Route.useRouteContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 登录页：不渲染 sidebar
  if (!me) {
    return (
      <html lang="zh-CN">
        <head>
          <HeadContent />
        </head>
        <body>
          <main className="min-h-screen bg-(--color-bg)">
            <Outlet />
          </main>
          <Scripts />
        </body>
      </html>
    );
  }

  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex min-h-screen bg-(--color-bg)">
          <Sidebar me={me} />
          <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} me={me} />
          <main className="min-w-0 flex-1 overflow-auto">
            <div className="sticky top-0 z-30 flex items-center border-b border-(--color-border) bg-(--color-card)/90 px-4 py-2 backdrop-blur lg:hidden" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-md p-1.5 text-(--color-muted) hover:bg-(--color-surface) hover:text-(--color-fg)"
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="ml-2 text-sm font-semibold">炼云工厂</span>
            </div>
            <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
              <Outlet />
            </div>
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
