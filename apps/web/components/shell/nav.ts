import type { Permission } from '@yangbenbu/shared';
import {
  CalendarDays,
  ClipboardList,
  KanbanSquare,
  KeyRound,
  LineChart,
  ScrollText,
  Users,
  UserCog,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 未設定代表所有登入者都可以看到 */
  permission?: Permission;
  /** 尚未開發的功能顯示預計的開發階段 */
  phase?: number;
}

export const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: '/board', label: '今日看板', icon: KanbanSquare, permission: 'board:read', phase: 1 },
      { href: '/patients', label: '病患', icon: Users, permission: 'patient:read' },
      {
        href: '/appointments',
        label: '預約',
        icon: CalendarDays,
        permission: 'appointment:read',
        phase: 1,
      },
      {
        href: '/follow-ups',
        label: '診後追蹤',
        icon: ClipboardList,
        permission: 'follow_up:read',
        phase: 2,
      },
      { href: '/reports', label: '報表', icon: LineChart, permission: 'report:read', phase: 2 },
    ],
  },
  {
    title: '管理',
    items: [
      { href: '/settings/staff', label: '員工帳號', icon: UserCog, permission: 'staff:manage' },
      { href: '/audit', label: '稽核紀錄', icon: ScrollText, permission: 'audit:read' },
      { href: '/settings/security', label: '帳號安全', icon: KeyRound },
    ],
  },
];
