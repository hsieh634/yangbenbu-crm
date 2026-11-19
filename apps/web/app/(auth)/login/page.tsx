'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { loginSchema, type LoginResult } from '@yangbenbu/shared';
import { LogIn } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FieldError, Input, Label } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { DEMO_PASSWORD, DemoAccounts } from './demo-accounts';

function safeRedirect(from: string | null): string {
  // 只允許站內路徑，避免開放式重新導向
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/board';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 示範站才顯示示範帳號；由 API 的 DEMO_MODE 決定，不需要重新建置前端
  const { data: options } = useQuery({
    queryKey: ['auth', 'options'],
    queryFn: () => api<{ demoMode: boolean }>('/auth/options'),
    staleTime: Infinity,
  });
  const login = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<LoginResult>('/auth/login', { method: 'POST', json: input }),
    onSuccess: (result) => {
      queryClient.clear();
      const from = params.get('from');
      if (result.status === 'mfa_required') {
        router.push(`/login/mfa${from ? `?from=${encodeURIComponent(from)}` : ''}`);
      } else {
        router.push(safeRedirect(from));
      }
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data);
  }

  const error =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? '無法連線，請稍後再試'
        : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">登入診所後台</h1>
      <p className="mt-1.5 text-sm text-ink-muted">請使用診所配發的帳號登入。</p>

      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          <FieldError>{fieldErrors.email}</FieldError>
        </div>
        <div>
          <Label htmlFor="password">密碼</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
          />
          <FieldError>{fieldErrors.password}</FieldError>
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          <LogIn />
          {login.isPending ? '登入中…' : '登入'}
        </Button>
      </form>

      {options?.demoMode && (
        <DemoAccounts
          onPick={(picked) => {
            setEmail(picked);
            setPassword(DEMO_PASSWORD);
            setFieldErrors({});
            login.reset();
          }}
        />
      )}
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
