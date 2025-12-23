-- Codigos 테이블 변경 감지 트리거 생성 스크립트
-- PostgreSQL 데이터베이스에서 실행하세요
-- 이 트리거는 codigos 테이블의 INSERT, UPDATE, DELETE 작업 시 자동으로 NOTIFY를 발생시켜
-- 웹소켓을 통해 다른 클라이언트들에게 실시간 알림을 전송합니다.

-- 트리거 함수: INSERT 작업
CREATE OR REPLACE FUNCTION notify_codigos_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'db_change_codigos_insert',
        json_build_object(
            'codigo', NEW.codigo,
            'id_codigo', NEW.id_codigo,
            'descripcion', NEW.descripcion,
            'pre1', NEW.pre1,
            'pre2', NEW.pre2,
            'pre3', NEW.pre3,
            'pre4', NEW.pre4,
            'pre5', NEW.pre5,
            'preorg', NEW.preorg,
            'utime', NEW.utime,
            'borrado', NEW.borrado,
            'fotonombre', NEW.fotonombre,
            'valor1', NEW.valor1,
            'valor2', NEW.valor2,
            'valor3', NEW.valor3,
            'pubip', NEW.pubip,
            'ip', NEW.ip,
            'mac', NEW.mac,
            'bmobile', NEW.bmobile,
            'tipocodigo', NEW.tipocodigo,
            'ref_id_todocodigo', NEW.ref_id_todocodigo,
            'ref_id_color', NEW.ref_id_color,
            'str_talle', NEW.str_talle,
            'ref_id_temporada', NEW.ref_id_temporada,
            'ref_id_talle', NEW.ref_id_talle,
            'b_sincronizar_x_web', NEW.b_sincronizar_x_web,
            'id_woocommerce', NEW.id_woocommerce,
            'id_woocommerce_producto', NEW.id_woocommerce_producto,
            'b_mostrar_vcontrol', NEW.b_mostrar_vcontrol,
            'codigoproducto', NEW.codigoproducto,
            'utime_modificado', NEW.utime_modificado,
            'id_codigo_centralizado', NEW.id_codigo_centralizado,
            'd_oferta_mode', NEW.d_oferta_mode
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 함수: UPDATE 작업
CREATE OR REPLACE FUNCTION notify_codigos_update()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'db_change_codigos_update',
        json_build_object(
            'codigo', NEW.codigo,
            'id_codigo', NEW.id_codigo,
            'descripcion', NEW.descripcion,
            'pre1', NEW.pre1,
            'pre2', NEW.pre2,
            'pre3', NEW.pre3,
            'pre4', NEW.pre4,
            'pre5', NEW.pre5,
            'preorg', NEW.preorg,
            'utime', NEW.utime,
            'borrado', NEW.borrado,
            'fotonombre', NEW.fotonombre,
            'valor1', NEW.valor1,
            'valor2', NEW.valor2,
            'valor3', NEW.valor3,
            'pubip', NEW.pubip,
            'ip', NEW.ip,
            'mac', NEW.mac,
            'bmobile', NEW.bmobile,
            'tipocodigo', NEW.tipocodigo,
            'ref_id_todocodigo', NEW.ref_id_todocodigo,
            'ref_id_color', NEW.ref_id_color,
            'str_talle', NEW.str_talle,
            'ref_id_temporada', NEW.ref_id_temporada,
            'ref_id_talle', NEW.ref_id_talle,
            'b_sincronizar_x_web', NEW.b_sincronizar_x_web,
            'id_woocommerce', NEW.id_woocommerce,
            'id_woocommerce_producto', NEW.id_woocommerce_producto,
            'b_mostrar_vcontrol', NEW.b_mostrar_vcontrol,
            'codigoproducto', NEW.codigoproducto,
            'utime_modificado', NEW.utime_modificado,
            'id_codigo_centralizado', NEW.id_codigo_centralizado,
            'd_oferta_mode', NEW.d_oferta_mode,
            -- 변경 전 값도 포함 (선택사항)
            'old_codigo', OLD.codigo,
            'old_id_codigo', OLD.id_codigo
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 함수: DELETE 작업
CREATE OR REPLACE FUNCTION notify_codigos_delete()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'db_change_codigos_delete',
        json_build_object(
            'codigo', OLD.codigo,
            'id_codigo', OLD.id_codigo,
            'descripcion', OLD.descripcion,
            'pre1', OLD.pre1,
            'pre2', OLD.pre2,
            'pre3', OLD.pre3,
            'pre4', OLD.pre4,
            'pre5', OLD.pre5,
            'preorg', OLD.preorg,
            'utime', OLD.utime,
            'borrado', OLD.borrado,
            'fotonombre', OLD.fotonombre,
            'valor1', OLD.valor1,
            'valor2', OLD.valor2,
            'valor3', OLD.valor3,
            'pubip', OLD.pubip,
            'ip', OLD.ip,
            'mac', OLD.mac,
            'bmobile', OLD.bmobile,
            'tipocodigo', OLD.tipocodigo,
            'ref_id_todocodigo', OLD.ref_id_todocodigo,
            'ref_id_color', OLD.ref_id_color,
            'str_talle', OLD.str_talle,
            'ref_id_temporada', OLD.ref_id_temporada,
            'ref_id_talle', OLD.ref_id_talle,
            'b_sincronizar_x_web', OLD.b_sincronizar_x_web,
            'id_woocommerce', OLD.id_woocommerce,
            'id_woocommerce_producto', OLD.id_woocommerce_producto,
            'b_mostrar_vcontrol', OLD.b_mostrar_vcontrol,
            'codigoproducto', OLD.codigoproducto,
            'utime_modificado', OLD.utime_modificado,
            'id_codigo_centralizado', OLD.id_codigo_centralizado,
            'd_oferta_mode', OLD.d_oferta_mode
        )::text
    );
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 기존 트리거 삭제 (있는 경우)
DROP TRIGGER IF EXISTS codigos_insert_trigger ON codigos;
DROP TRIGGER IF EXISTS codigos_update_trigger ON codigos;
DROP TRIGGER IF EXISTS codigos_delete_trigger ON codigos;

-- 트리거 생성
CREATE TRIGGER codigos_insert_trigger
    AFTER INSERT ON codigos
    FOR EACH ROW
    EXECUTE FUNCTION notify_codigos_insert();

CREATE TRIGGER codigos_update_trigger
    AFTER UPDATE ON codigos
    FOR EACH ROW
    EXECUTE FUNCTION notify_codigos_update();

CREATE TRIGGER codigos_delete_trigger
    AFTER DELETE ON codigos
    FOR EACH ROW
    EXECUTE FUNCTION notify_codigos_delete();

-- 트리거 생성 확인
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'codigos'
ORDER BY trigger_name;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE 'Codigos 테이블 트리거 생성 완료!';
    RAISE NOTICE '이제 codigos 테이블의 모든 변경사항이 웹소켓을 통해 실시간으로 알림됩니다.';
END $$;

