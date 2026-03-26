-- 모델에 정의된 uuid_{테이블이름} 컬럼을 실제 DB 테이블에 추가
-- 기존 컬럼이 있으면 에러가 나므로, 필요 시 각 ALTER 전에 "IF NOT EXISTS" 또는 제거 후 실행
-- PostgreSQL 13+ gen_random_uuid() 사용

ALTER TABLE public.codigos ADD COLUMN IF NOT EXISTS uuid_codigo UUID DEFAULT gen_random_uuid();
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS uuid_vdetalle UUID DEFAULT gen_random_uuid();
ALTER TABLE public.vcodes ADD COLUMN IF NOT EXISTS uuid_vcode UUID DEFAULT gen_random_uuid();
ALTER TABLE public.ingresos ADD COLUMN IF NOT EXISTS uuid_ingreso UUID DEFAULT gen_random_uuid();
ALTER TABLE public.parametros ADD COLUMN IF NOT EXISTS uuid_parametro UUID DEFAULT gen_random_uuid();
ALTER TABLE public.todocodigos ADD COLUMN IF NOT EXISTS uuid_todocodigo UUID DEFAULT gen_random_uuid();
ALTER TABLE public.gasto_info ADD COLUMN IF NOT EXISTS uuid_gasto_info UUID DEFAULT gen_random_uuid();
ALTER TABLE public.gastos ADD COLUMN IF NOT EXISTS uuid_gasto UUID DEFAULT gen_random_uuid();
ALTER TABLE public.color ADD COLUMN IF NOT EXISTS uuid_color UUID DEFAULT gen_random_uuid();
ALTER TABLE public.creditoventas ADD COLUMN IF NOT EXISTS uuid_creditoventa UUID DEFAULT gen_random_uuid();
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS uuid_cliente UUID DEFAULT gen_random_uuid();
ALTER TABLE public.tipos ADD COLUMN IF NOT EXISTS uuid_tipo UUID DEFAULT gen_random_uuid();
ALTER TABLE public.vtags ADD COLUMN IF NOT EXISTS uuid_vtag UUID DEFAULT gen_random_uuid();
ALTER TABLE public.online_ventas ADD COLUMN IF NOT EXISTS uuid_online_venta UUID DEFAULT gen_random_uuid();
ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS uuid_log UUID DEFAULT gen_random_uuid();
ALTER TABLE public.vendedores ADD COLUMN IF NOT EXISTS uuid_vendedore UUID DEFAULT gen_random_uuid();
ALTER TABLE public.fventas ADD COLUMN IF NOT EXISTS uuid_fventa UUID DEFAULT gen_random_uuid();
ALTER TABLE public.senias_vinculados ADD COLUMN IF NOT EXISTS uuid_senias_vinculado UUID DEFAULT gen_random_uuid();
ALTER TABLE public.temporadas ADD COLUMN IF NOT EXISTS uuid_temporada UUID DEFAULT gen_random_uuid();
ALTER TABLE public.cuentas ADD COLUMN IF NOT EXISTS uuid_cuenta UUID DEFAULT gen_random_uuid();

-- 복수형 uuid 컬럼 추가 (클라이언트에서 값 결정, 서버 기본값 없음)
ALTER TABLE public.codigos ADD COLUMN IF NOT EXISTS uuid_codigos UUID;
ALTER TABLE public.todocodigos ADD COLUMN IF NOT EXISTS uuid_todocodigos UUID;
ALTER TABLE public.temporadas ADD COLUMN IF NOT EXISTS uuid_temporadas UUID;
ALTER TABLE public.cuentas ADD COLUMN IF NOT EXISTS uuid_cuentas UUID;
