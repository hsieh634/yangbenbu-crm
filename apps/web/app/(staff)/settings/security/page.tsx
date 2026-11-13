'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { api } from '@/lib/api';
import { ME_KEY, useMe } from '@/lib/auth';

function MfaSetup() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');

  const start = useMutation({
    mutationFn: async () => {
      const r = await api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', {
        method: 'POST',
      });
      return {
        secret: r.secret,
        qr: await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 200 }),
      };
    },
    onSuccess: setSetup,
  });

  const enable = useMutation({
    mutationFn: () => api('/auth/mfa/enable', { method: 'POST', json: { code } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
  });

  if (!setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          啟用後，每次登入除了密碼，還需要輸入手機驗證器 App 產生的 6
          位數驗證碼。即使密碼外洩，他人也無法登入。
        </p>
        {start.error && <Alert>{start.error.message}</Alert>}
        <Button onClick={() => start.mutate()} disabled={start.isPending}>
          <Smartphone /> 開始設定
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL，不需要最佳化 */}
      <img
        src={setup.qr}
        alt="兩步驟驗證 QR Code"
        className="size-48 rounded-lg border border-line"
      />
      <div className="space-y-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>以 Google Authenticator 或 Microsoft Authenticator 掃描 QR Code</li>
          <li>輸入 App 顯示的 6 位數驗證碼完成啟用</li>
        </ol>
        <p className="text-xs text-ink-muted">
          無法掃描？手動輸入金鑰：
          <code className="break-all rounded bg-paper px-1 py-0.5">{setup.secret}</code>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enable.mutate();
          }}
          className="flex max-w-xs items-end gap-2"
        >
          <div className="flex-1">
            <Label htmlFor="code">驗證碼</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono tracking-widest"
            />
          </div>
          <Button type="submit" disabled={code.length !== 6 || enable.isPending}>
            啟用
          </Button>
        </form>
        {enable.error && <Alert>{enable.error.message}</Alert>}
      </div>
    </div>
  );
}

export default function SecurityPage() {
  const { data: me } = useMe();
  if (!me) return null;

  return (
    <>
      <PageHeader title="帳號安全" />
      {me.mfaEnrollmentRequired && (
        <Alert className="mb-6 max-w-2xl">
          本診所要求所有員工啟用兩步驟驗證，完成設定後才能使用其他功能。
        </Alert>
      )}
      <Card className="max-w-2xl">
        <CardHeader className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-jade-700" />
          <CardTitle>兩步驟驗證</CardTitle>
        </CardHeader>
        <CardContent>
          {me.staff.mfaEnabled ? (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-5 text-jade-600" />
              已啟用。其他裝置已自動登出，需以驗證碼重新登入。
            </p>
          ) : (
            <MfaSetup />
          )}
        </CardContent>
      </Card>
    </>
  );
}
