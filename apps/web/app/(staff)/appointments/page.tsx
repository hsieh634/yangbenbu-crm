import { ComingSoon } from '@/components/shell/guards';

export default function Page() {
  return (
    <ComingSoon
      title="預約"
      phase={1}
      items={['依醫師分欄的日／週行事曆', '醫師排班與每時段可約人數', '報到後自動建立就診單並進入今日看板', '未到（No-show）統計']}
    />
  );
}
