-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DOCTOR', 'FRONT_DESK', 'CLINICAL_ASSISTANT', 'HEALTH_MANAGER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateTable
CREATE TABLE "clinic" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_enc" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_membership" (
    "id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinic_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "staff_id" UUID NOT NULL,
    "active_clinic_id" UUID NOT NULL,
    "mfa_pending" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient" (
    "clinic_id" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.clinic_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "chart_no" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "birth_date" DATE NOT NULL,
    "phone" TEXT NOT NULL,
    "national_id_enc" TEXT,
    "national_id_hash" TEXT,
    "national_id_last4" TEXT,
    "allergies" TEXT,
    "medical_history" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "clinic_id" UUID,
    "actor_staff_id" UUID,
    "actor_role" "Role",
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "patient_id" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinic_slug_key" ON "clinic"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "staff_email_key" ON "staff"("email");

-- CreateIndex
CREATE INDEX "clinic_membership_staff_id_idx" ON "clinic_membership"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_membership_clinic_id_staff_id_key" ON "clinic_membership"("clinic_id", "staff_id");

-- CreateIndex
CREATE INDEX "session_staff_id_idx" ON "session"("staff_id");

-- CreateIndex
CREATE INDEX "patient_clinic_id_name_idx" ON "patient"("clinic_id", "name");

-- CreateIndex
CREATE INDEX "patient_clinic_id_phone_idx" ON "patient"("clinic_id", "phone");

-- CreateIndex
CREATE INDEX "patient_clinic_id_national_id_last4_idx" ON "patient"("clinic_id", "national_id_last4");

-- CreateIndex
CREATE UNIQUE INDEX "patient_clinic_id_chart_no_key" ON "patient"("clinic_id", "chart_no");

-- CreateIndex
CREATE UNIQUE INDEX "patient_clinic_id_national_id_hash_key" ON "patient"("clinic_id", "national_id_hash");

-- CreateIndex
CREATE INDEX "audit_log_clinic_id_created_at_idx" ON "audit_log"("clinic_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_clinic_id_patient_id_created_at_idx" ON "audit_log"("clinic_id", "patient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_staff_id_created_at_idx" ON "audit_log"("actor_staff_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "clinic_membership" ADD CONSTRAINT "clinic_membership_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_membership" ADD CONSTRAINT "clinic_membership_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient" ADD CONSTRAINT "patient_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
