-- ════════════════════════════════════════════════════════════════════
-- 今日看板即時同步
--
-- 預約、就診、服務項目、交接備註有變動時，以 pg_notify 發出事件；
-- API 以 LISTEN 接收後，透過 Server-Sent Events 推給同一家診所開著看板的瀏覽器。
--
-- 做在資料庫 trigger 而不是程式碼裡：API、Worker（示範資料推進、未到標記）
-- 任何來源的寫入都會通知，多台 API 也都收得到。
-- 通知在交易 COMMIT 後才送出，交易失敗不會發出假通知。
-- 內容只有診所 ID、資料表與資料列 ID，不含任何個資。
-- ════════════════════════════════════════════════════════════════════
CREATE FUNCTION notify_board_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  rec record;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := OLD; ELSE rec := NEW; END IF;
  PERFORM pg_notify(
    'board_change',
    json_build_object('clinicId', rec.clinic_id, 'table', TG_TABLE_NAME, 'id', rec.id)::text
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER board_change AFTER INSERT OR UPDATE OR DELETE ON "appointment"
  FOR EACH ROW EXECUTE FUNCTION notify_board_change();
CREATE TRIGGER board_change AFTER INSERT OR UPDATE OR DELETE ON "visit"
  FOR EACH ROW EXECUTE FUNCTION notify_board_change();
CREATE TRIGGER board_change AFTER INSERT OR UPDATE OR DELETE ON "visit_service"
  FOR EACH ROW EXECUTE FUNCTION notify_board_change();
CREATE TRIGGER board_change AFTER INSERT OR UPDATE OR DELETE ON "handoff_note"
  FOR EACH ROW EXECUTE FUNCTION notify_board_change();
