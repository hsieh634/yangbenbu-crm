'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LoginResult } from '@yangbenbu/shared';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');

  const verify = useMutation({
    mutationFn: () => api<LoginResult>('/auth/mfa/verify', { method: 'POST', json: { code } }),
    onSuccess: () => {
      queryClient.clear();
      const from = params.get('from');
      router.push(from && from.startsWith('/') && !from.startsWith('//') ? from : '/board');
    },
  });

  const expired =
    verify.error instanceof ApiError &&
    verify.error.status === 401 &&
    verify.error.code !== 'INVALID_TOTP';

  return (
    <>
      <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-jade-50 text-jade-700">
        <ShieldCheck className="size-6" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">兩步驟驗證</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        請開啟驗證器 App（Google Authenticator、Microsoft Authenticator 等），輸入 6 位數驗證碼。
      </p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          verify.mutate();
        }}
      >
        {verify.error && (
          <Alert>
            {expired ? (
              <>
                驗證逾時，請
                <Link href="/login" className="underline">
                  重新登入
                </Link>
                。
              </>
            ) : (
              verify.error.message
            )}
          </Alert>
        )}
        <div>
          <Label htmlFor="code">驗證碼</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="h-12 text-center font-mono text-xl tracking-[0.5em]"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={code.length !== 6 || verify.isPending}
        >
          {verify.isPending ? '驗證中…' : '驗證並登入'}
        </Button>
        <Link href="/login" className="block text-center text-sm text-ink-muted hover:text-ink">
          改用其他帳號
        </Link>
      </form>
    </>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
