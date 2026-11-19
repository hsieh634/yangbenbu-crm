'use client';

import { useQuery } from '@tanstack/react-query';
import type { PatientDetail } from '@yangbenbu/shared';
import { useParams } from 'next/navigation';
import { PatientForm } from '@/components/patients/patient-form';
import { RequirePermission } from '@/components/shell/guards';
import { Alert, PageHeader, Skeleton } from '@/components/ui/feedback';
import { api } from '@/lib/api';

function Edit() {
  const { id } = useParams<{ id: string }>();
  const { data, isPending, error } = useQuery({
    queryKey: ['patients', id],
    queryFn: () => api<PatientDetail>(`/patients/${id}`),
  });
  if (error) return <Alert>{error.message}</Alert>;
  if (isPending) return <Skeleton className="h-96 w-full" />;
  return (
    <>
      <PageHeader
        title={`編輯：${data.name}`}
        description={`病歷號 ${data.chartNo}・修改紀錄會寫入稽核（只記欄位名稱）`}
      />
      <PatientForm patient={data} />
    </>
  );
}

export default function EditPatientPage() {
  return (
    <RequirePermission permission="patient:write">
      <Edit />
    </RequirePermission>
  );
}
