-- Codigos 테이블 트리거 확인 스크립트
-- PostgreSQL 데이터베이스에서 실행하여 트리거가 제대로 설치되었는지 확인하세요

-- 트리거 목록 확인
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'codigos'
ORDER BY trigger_name;

-- 트리거 함수 확인
SELECT 
    proname as function_name,
    prosrc as function_body
FROM pg_proc
WHERE proname IN ('notify_codigos_insert', 'notify_codigos_update', 'notify_codigos_delete')
ORDER BY proname;

-- 예상 결과:
-- 3개의 트리거가 있어야 합니다:
-- 1. codigos_insert_trigger (AFTER INSERT)
-- 2. codigos_update_trigger (AFTER UPDATE)
-- 3. codigos_delete_trigger (AFTER DELETE)
--
-- 3개의 함수가 있어야 합니다:
-- 1. notify_codigos_insert
-- 2. notify_codigos_update
-- 3. notify_codigos_delete

