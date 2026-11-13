import { ComingSoon } from '@/components/shell/guards';

export default function Page() {
  return (
    <ComingSoon
      title="報表"
      phase={2}
      items={[
        '預約數、到診率、未到率',
        '療程銷售與未使用堂數',
        '30／60／90 天回診率',
        '追蹤任務完成率',
        '所有報表可匯出 CSV',
      ]}
    />
  );
}
