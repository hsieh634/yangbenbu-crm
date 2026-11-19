'use client';

import { PatientForm } from '@/components/patients/patient-form';
import { RequirePermission } from '@/components/shell/guards';
import { PageHeader } from '@/components/ui/feedback';

export default function NewPatientPage() {
  return (
    <RequirePermission permission="patient:write">
      <PageHeader
        title="新增病患"
        description="姓名、性別、生日、電話為必填；身分證字號加密儲存。"
      />
      <PatientForm />
    </RequirePermission>
  );
}
