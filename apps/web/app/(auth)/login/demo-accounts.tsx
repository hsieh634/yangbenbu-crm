'use client';

import { ROLE_LABELS, type Role } from '@yangbenbu/shared';

const DEMO_ACCOUNTS: { email: string; name: string; role: Role; note: string }[] = [
  {
    email: 'admin@yangbenbu.demo',
    name: '林雅文',
    role: 'ADMIN',
    note: '診所設定、稽核紀錄、員工帳號',
  },
  {
    email: 'doctor@yangbenbu.demo',
    name: '陳柏翰',
    role: 'DOCTOR',
    note: '填寫醫師欄位；同時屬於兩家診所',
  },
  {
    email: 'frontdesk@yangbenbu.demo',
    name: '張曉芸',
    role: 'FRONT_DESK',
    note: '預約、報到、扣堂；看不到醫師欄位',
  },
  {
    email: 'assistant@yangbenbu.demo',
    name: '黃志明',
    role: 'CLINICAL_ASSISTANT',
    note: '推進看板、登記療程；不能編輯病患',
  },
  {
    email: 'health@yangbenbu.demo',
    name: '吳佩珊',
    role: 'HEALTH_MANAGER',
    note: '看板唯讀；看不到地址與身分證',
  },
];

export const DEMO_PASSWORD = 'Demo1234!';

export function DemoAccounts({ onPick }: { onPick: (email: string) => void }) {
  return (
    <div className="mt-8 rounded-xl border border-dashed border-jade-200 bg-jade-50/60 p-4">
      <p className="text-sm font-medium text-jade-800">示範帳號</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        點選即可帶入，密碼皆為{' '}
        <code className="rounded bg-surface px-1 py-0.5">{DEMO_PASSWORD}</code>。所有資料皆為虛構。
      </p>
      <ul className="mt-3 grid gap-1.5">
        {DEMO_ACCOUNTS.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              onClick={() => onPick(a.email)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface"
            >
              <span className="w-20 shrink-0 text-xs font-medium text-jade-700">
                {ROLE_LABELS[a.role]}
              </span>
              <span className="text-ink">{a.name}</span>
              <span className="ml-auto truncate text-xs text-ink-muted">{a.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
