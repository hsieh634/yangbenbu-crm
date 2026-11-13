-- ════════════════════════════════════════════════════════════════════
-- 多租戶隔離：Row-Level Security
--
-- 應用程式在每個交易開頭執行
--   SELECT set_config('app.clinic_id', '<診所 UUID>', true);
-- 政策只允許存取 clinic_id 等於該設定值的資料列。
-- 沒設定時 current_setting 回傳 NULL 或空字串，條件不成立 → 看不到任何資料（預設拒絕）。
--
-- FORCE ROW LEVEL SECURITY 讓資料表擁有者也受政策限制；
-- 應用程式連線角色不可是超級使用者或具 BYPASSRLS（API 啟動時會檢查）。
-- ════════════════════════════════════════════════════════════════════

CREATE FUNCTION app_current_clinic_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid $$;

-- ── patient ─────────────────────────────────────────────────────────
ALTER TABLE "patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "patient"
  USING (clinic_id = app_current_clinic_id())
  WITH CHECK (clinic_id = app_current_clinic_id());

-- ── audit_log ───────────────────────────────────────────────────────
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

-- 只能讀到自己診所的紀錄
CREATE POLICY tenant_read ON "audit_log" FOR SELECT
  USING (clinic_id = app_current_clinic_id());

-- 寫入：本診所的事件，或不屬於任何診所的系統事件（例如登入失敗）
CREATE POLICY tenant_insert ON "audit_log" FOR INSERT
  WITH CHECK (clinic_id IS NULL OR clinic_id = app_current_clinic_id());

-- 沒有 UPDATE / DELETE 政策 → RLS 下一律拒絕

-- ════════════════════════════════════════════════════════════════════
-- 稽核紀錄只能新增：即使繞過 RLS，trigger 也會拒絕修改與刪除
-- ════════════════════════════════════════════════════════════════════

CREATE FUNCTION audit_log_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
