import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { Loader2, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { fetchMeFn, loginFn } from '~/server/fns/auth';

export const Route = createFileRoute('/login')({
  component: LoginPage,
  beforeLoad: async () => {
    const me = await fetchMeFn();
    if (me) throw redirect({ to: '/' });
  },
});

function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await loginFn({ data: { username: username.trim(), password } });
      await router.invalidate();
      router.navigate({ to: '/' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-(--color-border) bg-(--color-card) p-6 shadow-sm"
      >
        <div className="mb-5 flex flex-col items-center gap-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-(--color-accent-soft) text-(--color-accent)">
            <LogIn className="h-5 w-5" />
          </div>
          <h1 className="text-base font-semibold">炼云工厂登录</h1>
          <p className="text-xs text-(--color-muted)">账号由管理员通过脚本创建</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">账号</Label>
            <Input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">密码</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
              {err}
            </div>
          )}
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            登录
          </Button>
        </div>
      </form>
    </div>
  );
}
