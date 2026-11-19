-- Phase 1：診所設定、排班與預約、就診、療程、領藥
--
-- 病史與過敏改為應用層加密（allergies_enc、medical_history_enc）。
-- 加密需要應用程式金鑰，無法在 SQL 中轉換；此時尚未上線，只有示範資料，
-- 舊欄位直接移除，重新執行 seed 即會補上加密後的資料。
-- CreateEnum
CREATE TYPE "ServiceCategory" AS ENUM ('CONSULTATION', 'ACUPUNCTURE', 'TUINA', 'CUPPING', 'MOXIBUSTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('FRONT_DESK', 'PHONE', 'LINE', 'WALK_IN');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'IN_TREATMENT', 'PENDING_CHECKOUT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackageUsageKind" AS ENUM ('DEDUCT', 'REVERSAL');

-- AlterTable
ALTER TABLE "patient" DROP COLUMN "allergies",
DROP COLUMN "medical_history",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "allergies_enc" TEXT,
ADD COLUMN     "consent_signed_at" TIMESTAMP(3),
ADD COLUMN     "consent_version" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "has_allergy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "medical_history_enc" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "updated_by_id" UUID;

-- CreateTable
CREATE TABLE "room" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ServiceCategory" NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_plan" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "service_id" UUID NOT NULL,
    "sessions" INTEGER NOT NULL,
    "valid_days" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedule" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "slot_minutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "room_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_closure" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "doctor_id" UUID,
    "reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_closure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "service_id" UUID,
    "room_id" UUID,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "AppointmentSource" NOT NULL DEFAULT 'FRONT_DESK',
    "note" TEXT,
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "doctor_id" UUID,
    "room_id" UUID,
    "visit_date" DATE NOT NULL,
    "status" "VisitStatus" NOT NULL DEFAULT 'CHECKED_IN',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "clinical_note_enc" TEXT,
    "clinical_note_updated_at" TIMESTAMP(3),
    "clinical_note_updated_by_id" UUID,
    "his_visit_no" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_event" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "from_status" "VisitStatus",
    "to_status" "VisitStatus" NOT NULL,
    "actor_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_service" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "package_usage_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by_id" UUID,

    CONSTRAINT "visit_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_note" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "author_id" UUID,
    "target_role" "Role",
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,

    CONSTRAINT "handoff_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_package" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "plan_id" UUID,
    "name" TEXT NOT NULL,
    "service_id" UUID NOT NULL,
    "total_sessions" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "purchased_on" DATE NOT NULL,
    "expires_on" DATE NOT NULL,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_usage" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "visit_id" UUID,
    "kind" "PackageUsageKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reversal_of_id" UUID,
    "idempotency_key" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_dispense" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "visit_id" UUID,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "dispensed_on" DATE NOT NULL,
    "next_eligible_on" DATE NOT NULL,
    "his_rx_no" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "medication_dispense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_clinic_id_name_key" ON "room"("clinic_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_clinic_id_code_key" ON "service"("clinic_id", "code");

-- CreateIndex
CREATE INDEX "package_plan_clinic_id_service_id_idx" ON "package_plan"("clinic_id", "service_id");

-- CreateIndex
CREATE INDEX "doctor_schedule_clinic_id_doctor_id_weekday_idx" ON "doctor_schedule"("clinic_id", "doctor_id", "weekday");

-- CreateIndex
CREATE INDEX "schedule_closure_clinic_id_date_idx" ON "schedule_closure"("clinic_id", "date");

-- CreateIndex
CREATE INDEX "appointment_clinic_id_start_at_idx" ON "appointment"("clinic_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_clinic_id_doctor_id_start_at_idx" ON "appointment"("clinic_id", "doctor_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_clinic_id_patient_id_start_at_idx" ON "appointment"("clinic_id", "patient_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "visit_appointment_id_key" ON "visit"("appointment_id");

-- CreateIndex
CREATE INDEX "visit_clinic_id_visit_date_idx" ON "visit"("clinic_id", "visit_date");

-- CreateIndex
CREATE INDEX "visit_clinic_id_patient_id_checked_in_at_idx" ON "visit"("clinic_id", "patient_id", "checked_in_at" DESC);

-- CreateIndex
CREATE INDEX "visit_event_clinic_id_visit_id_created_at_idx" ON "visit_event"("clinic_id", "visit_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "visit_service_package_usage_id_key" ON "visit_service"("package_usage_id");

-- CreateIndex
CREATE INDEX "visit_service_clinic_id_visit_id_idx" ON "visit_service"("clinic_id", "visit_id");

-- CreateIndex
CREATE INDEX "handoff_note_clinic_id_visit_id_idx" ON "handoff_note"("clinic_id", "visit_id");

-- CreateIndex
CREATE INDEX "patient_package_clinic_id_patient_id_idx" ON "patient_package"("clinic_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "package_usage_reversal_of_id_key" ON "package_usage"("reversal_of_id");

-- CreateIndex
CREATE INDEX "package_usage_clinic_id_package_id_idx" ON "package_usage"("clinic_id", "package_id");

-- CreateIndex
CREATE INDEX "package_usage_clinic_id_patient_id_created_at_idx" ON "package_usage"("clinic_id", "patient_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "package_usage_clinic_id_idempotency_key_key" ON "package_usage"("clinic_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "medication_dispense_clinic_id_patient_id_dispensed_on_idx" ON "medication_dispense"("clinic_id", "patient_id", "dispensed_on" DESC);

-- AddForeignKey
ALTER TABLE "package_plan" ADD CONSTRAINT "package_plan_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedule" ADD CONSTRAINT "doctor_schedule_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_event" ADD CONSTRAINT "visit_event_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_service" ADD CONSTRAINT "visit_service_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_note" ADD CONSTRAINT "handoff_note_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_package" ADD CONSTRAINT "patient_package_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_usage" ADD CONSTRAINT "package_usage_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "patient_package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_dispense" ADD CONSTRAINT "medication_dispense_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- Row-Level Security：與 patient 相同，只能存取目前診所（app.clinic_id）的資料
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'room', 'service', 'package_plan', 'doctor_schedule', 'schedule_closure',
    'appointment', 'visit', 'visit_event', 'visit_service', 'handoff_note',
    'patient_package', 'package_usage', 'medication_dispense'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_current_clinic_id()) WITH CHECK (clinic_id = app_current_clinic_id())',
      t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 跨診所參照檢查
--
-- 外鍵檢查不受 RLS 限制：只靠外鍵，appointment 可以指向「別家診所」的病患 ID。
-- 這個 trigger 確認被參照的資料列屬於同一家診所，作為服務層檢查之外的第二道防線。
-- 參數：(欄位名稱, 被參照的資料表)
-- ════════════════════════════════════════════════════════════════════
CREATE FUNCTION assert_same_clinic() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ref_id uuid;
  ok boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO ref_id USING NEW;
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND clinic_id = $2)', TG_ARGV[1])
    INTO ok USING ref_id, NEW.clinic_id;
  IF NOT ok THEN
    RAISE EXCEPTION '%.% references a % row outside clinic %', TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1], NEW.clinic_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER same_clinic_service    BEFORE INSERT OR UPDATE ON "package_plan"        FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('service_id', 'service');
CREATE TRIGGER same_clinic_room       BEFORE INSERT OR UPDATE ON "doctor_schedule"     FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('room_id', 'room');
CREATE TRIGGER same_clinic_patient    BEFORE INSERT OR UPDATE ON "appointment"         FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('patient_id', 'patient');
CREATE TRIGGER same_clinic_service    BEFORE INSERT OR UPDATE ON "appointment"         FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('service_id', 'service');
CREATE TRIGGER same_clinic_room       BEFORE INSERT OR UPDATE ON "appointment"         FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('room_id', 'room');
CREATE TRIGGER same_clinic_patient    BEFORE INSERT OR UPDATE ON "visit"               FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('patient_id', 'patient');
CREATE TRIGGER same_clinic_appt       BEFORE INSERT OR UPDATE ON "visit"               FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('appointment_id', 'appointment');
CREATE TRIGGER same_clinic_room       BEFORE INSERT OR UPDATE ON "visit"               FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('room_id', 'room');
CREATE TRIGGER same_clinic_visit      BEFORE INSERT OR UPDATE ON "visit_event"         FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('visit_id', 'visit');
CREATE TRIGGER same_clinic_visit      BEFORE INSERT OR UPDATE ON "visit_service"       FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('visit_id', 'visit');
CREATE TRIGGER same_clinic_service    BEFORE INSERT OR UPDATE ON "visit_service"       FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('service_id', 'service');
CREATE TRIGGER same_clinic_visit      BEFORE INSERT OR UPDATE ON "handoff_note"        FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('visit_id', 'visit');
CREATE TRIGGER same_clinic_patient    BEFORE INSERT OR UPDATE ON "patient_package"     FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('patient_id', 'patient');
CREATE TRIGGER same_clinic_service    BEFORE INSERT OR UPDATE ON "patient_package"     FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('service_id', 'service');
CREATE TRIGGER same_clinic_package    BEFORE INSERT ON "package_usage"                 FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('package_id', 'patient_package');
CREATE TRIGGER same_clinic_patient    BEFORE INSERT ON "package_usage"                 FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('patient_id', 'patient');
CREATE TRIGGER same_clinic_visit      BEFORE INSERT ON "package_usage"                 FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('visit_id', 'visit');
CREATE TRIGGER same_clinic_patient    BEFORE INSERT OR UPDATE ON "medication_dispense" FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('patient_id', 'patient');
CREATE TRIGGER same_clinic_visit      BEFORE INSERT OR UPDATE ON "medication_dispense" FOR EACH ROW EXECUTE FUNCTION assert_same_clinic('visit_id', 'visit');

-- ════════════════════════════════════════════════════════════════════
-- 只能新增的紀錄：扣堂紀錄、就診狀態轉換
-- 剩餘堂數由扣堂紀錄加總而來，紀錄不可修改，帳才對得起來；更正一律以沖銷處理。
-- ════════════════════════════════════════════════════════════════════
CREATE FUNCTION append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER package_usage_append_only BEFORE UPDATE OR DELETE ON "package_usage"
  FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER package_usage_no_truncate BEFORE TRUNCATE ON "package_usage"
  FOR EACH STATEMENT EXECUTE FUNCTION append_only();
CREATE TRIGGER visit_event_append_only BEFORE UPDATE OR DELETE ON "visit_event"
  FOR EACH ROW EXECUTE FUNCTION append_only();
CREATE TRIGGER visit_event_no_truncate BEFORE TRUNCATE ON "visit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION append_only();

-- ════════════════════════════════════════════════════════════════════
-- 資料檢查
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE "package_usage" ADD CONSTRAINT package_usage_quantity_check
  CHECK ((kind = 'DEDUCT' AND quantity = 1 AND reversal_of_id IS NULL)
      OR (kind = 'REVERSAL' AND quantity = -1 AND reversal_of_id IS NOT NULL));
ALTER TABLE "patient_package" ADD CONSTRAINT patient_package_sessions_check
  CHECK (total_sessions > 0 AND price >= 0 AND expires_on >= purchased_on);
ALTER TABLE "package_plan" ADD CONSTRAINT package_plan_values_check
  CHECK (sessions > 0 AND valid_days > 0 AND price >= 0);
ALTER TABLE "doctor_schedule" ADD CONSTRAINT doctor_schedule_values_check
  CHECK (weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440
     AND start_minute < end_minute AND slot_minutes > 0 AND capacity > 0);
ALTER TABLE "appointment" ADD CONSTRAINT appointment_time_check CHECK (start_at < end_at);
ALTER TABLE "medication_dispense" ADD CONSTRAINT medication_dispense_days_check
  CHECK (days > 0 AND next_eligible_on >= dispensed_on);
