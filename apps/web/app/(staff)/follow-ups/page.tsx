import { ComingSoon } from '@/components/shell/guards';

export default function Page() {
  return (
    <ComingSoon
      title="診後追蹤"
      phase={2}
      items={['依調理方案自動產生追蹤任務', '今日待辦、逾期、已完成', '電話與 LINE 關懷紀錄', 'LINE 訊息範本']}
    />
  );
}
