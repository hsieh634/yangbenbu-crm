'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PatientSummary } from '@yangbenbu/shared';
import { useState } from 'react';
import { PatientPicker } from '@/components/patients/patient-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useClinicConfig } from '@/lib/queries';

/** 現場掛號：沒有預約直接報到，病患立即出現在看板「已報到」欄 */
export function WalkInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: config } = useClinicConfig();
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const close = () => {
    setPatient(null);
    setServiceId('');
    onClose();
  };
  const doctor = doctorId || config?.doctors[0]?.id || '';
  const checkIn = useMutation({
    mutationFn: () =>
      api('/visits', {
        method: 'POST',
        json: { patientId: patient!.id, doctorId: doctor, serviceId: serviceId || null },
      }),
    onSuccess: () => {
      toast(`${patient!.name} 已報到`);
      void qc.invalidateQueries({ queryKey: ['board'] });
      close();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title="現場掛號"
      description="沒有預約的病患直接報到"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button
            disabled={!patient || !doctor || checkIn.isPending}
            onClick={() => checkIn.mutate()}
          >
            報到
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {checkIn.error && (
          <Alert>{checkIn.error instanceof ApiError ? checkIn.error.message : '報到失敗'}</Alert>
        )}
        <div>
          <Label>病患</Label>
          <PatientPicker value={patient} onChange={setPatient} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="walkin-doctor">醫師</Label>
            <Select id="walkin-doctor" value={doctor} onChange={(e) => setDoctorId(e.target.value)}>
              {config?.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="walkin-service">服務項目</Label>
            <Select
              id="walkin-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">看診</option>
              {config?.services
                .filter((s) => s.isActive && s.category !== 'CONSULTATION')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
