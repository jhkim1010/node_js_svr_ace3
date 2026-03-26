-- t2 테이블에 ref_id_{t1} 옆에 ref_uuid_{t1} UUID 컬럼 추가 후, t1.uuid_{t1} 와 연동해 값 채우기
-- 실행 전 add-uuid-columns.sql 로 uuid_* 컬럼이 있어야 함.
--
-- clientes 참조: ref_id_cliente 는 clientes.id 와 비교 (populate-ref-uuid-columns.sql 참고).

-- ========== 1. ref_uuid_* 컬럼 추가 (UUID만 추가, FK는 uuid_* 에 UNIQUE 부여 후 별도로 추가 가능) ==========

-- vdetalle
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS ref_uuid_codigo UUID;
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS ref_uuid_todocodigo UUID;
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS ref_uuid_vendedore UUID;
ALTER TABLE public.vdetalle ADD COLUMN IF NOT EXISTS ref_uuid_cliente UUID;

-- creditoventas
ALTER TABLE public.creditoventas ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;
ALTER TABLE public.creditoventas ADD COLUMN IF NOT EXISTS ref_uuid_cliente UUID;

-- fventas
ALTER TABLE public.fventas ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;

-- vtags
ALTER TABLE public.vtags ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;
ALTER TABLE public.vtags ADD COLUMN IF NOT EXISTS ref_uuid_cuenta UUID;

-- ingresos
ALTER TABLE public.ingresos ADD COLUMN IF NOT EXISTS ref_uuid_codigo UUID;
ALTER TABLE public.ingresos ADD COLUMN IF NOT EXISTS ref_uuid_todocodigo UUID;

-- senias_vinculados
ALTER TABLE public.senias_vinculados ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;
ALTER TABLE public.senias_vinculados ADD COLUMN IF NOT EXISTS ref_uuid_cliente UUID;

-- online_ventas
ALTER TABLE public.online_ventas ADD COLUMN IF NOT EXISTS ref_uuid_vcode UUID;
ALTER TABLE public.online_ventas ADD COLUMN IF NOT EXISTS ref_uuid_vcode_pagado UUID;

-- codigos
ALTER TABLE public.codigos ADD COLUMN IF NOT EXISTS ref_uuid_todocodigo UUID;
ALTER TABLE public.codigos ADD COLUMN IF NOT EXISTS ref_uuid_color UUID;
ALTER TABLE public.codigos ADD COLUMN IF NOT EXISTS ref_uuid_temporada UUID;

-- todocodigos
ALTER TABLE public.todocodigos ADD COLUMN IF NOT EXISTS ref_uuid_temporada UUID;
ALTER TABLE public.todocodigos ADD COLUMN IF NOT EXISTS ref_uuid_tipo UUID;

-- clientes
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS ref_uuid_vendedore UUID;

-- vcodes
ALTER TABLE public.vcodes ADD COLUMN IF NOT EXISTS ref_uuid_cliente UUID;
ALTER TABLE public.vcodes ADD COLUMN IF NOT EXISTS ref_uuid_vendedore UUID;


-- ========== 2. 기존 ref_id_* 기준으로 ref_uuid_* 값 채우기 (clientes 는 cl.id 로 조인) ==========

-- vdetalle
UPDATE public.vdetalle t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;
UPDATE public.vdetalle t SET ref_uuid_codigo = c.uuid_codigo FROM public.codigos c WHERE t.ref_id_codigo = c.id_codigo AND t.ref_uuid_codigo IS NULL;
UPDATE public.vdetalle t SET ref_uuid_todocodigo = tc.uuid_todocodigo FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;
UPDATE public.vdetalle t SET ref_uuid_vendedore = vd.uuid_vendedore FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;
UPDATE public.vdetalle t SET ref_uuid_cliente = cl.uuid_cliente FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- creditoventas
UPDATE public.creditoventas t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;
UPDATE public.creditoventas t SET ref_uuid_cliente = cl.uuid_cliente FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- fventas
UPDATE public.fventas t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

-- vtags
UPDATE public.vtags t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;
UPDATE public.vtags t SET ref_uuid_cuenta = cu.uuid_cuenta FROM public.cuentas cu WHERE t.ref_id_cuenta = cu.id_cuenta AND t.ref_uuid_cuenta IS NULL;

-- ingresos
UPDATE public.ingresos t SET ref_uuid_codigo = c.uuid_codigo FROM public.codigos c WHERE t.ref_id_codigo = c.id_codigo AND t.ref_uuid_codigo IS NULL;
UPDATE public.ingresos t SET ref_uuid_todocodigo = tc.uuid_todocodigo FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;

-- senias_vinculados
UPDATE public.senias_vinculados t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;
UPDATE public.senias_vinculados t SET ref_uuid_cliente = cl.uuid_cliente FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- online_ventas (ref_id_vcode, ref_id_vcode_pagado -> 동일 vcodes)
UPDATE public.online_ventas t SET ref_uuid_vcode = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;
UPDATE public.online_ventas t SET ref_uuid_vcode_pagado = v.uuid_vcode FROM public.vcodes v WHERE t.ref_id_vcode_pagado = v.vcode_id AND t.ref_uuid_vcode_pagado IS NULL;

-- codigos
UPDATE public.codigos t SET ref_uuid_todocodigo = tc.uuid_todocodigo FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;
UPDATE public.codigos t SET ref_uuid_color = co.uuid_color FROM public.color co WHERE t.ref_id_color = co.id_color AND t.ref_uuid_color IS NULL;
UPDATE public.codigos t SET ref_uuid_temporada = tm.uuid_temporada FROM public.temporadas tm WHERE t.ref_id_temporada = tm.id_temporada AND t.ref_uuid_temporada IS NULL;

-- todocodigos
UPDATE public.todocodigos t SET ref_uuid_temporada = tm.uuid_temporada FROM public.temporadas tm WHERE t.ref_id_temporada = tm.id_temporada AND t.ref_uuid_temporada IS NULL;
UPDATE public.todocodigos t SET ref_uuid_tipo = tp.uuid_tipo FROM public.tipos tp WHERE t.ref_id_tipo = tp.id_tipo AND t.ref_uuid_tipo IS NULL;

-- clientes
UPDATE public.clientes t SET ref_uuid_vendedore = vd.uuid_vendedore FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;

-- vcodes
UPDATE public.vcodes t SET ref_uuid_cliente = cl.uuid_cliente FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;
UPDATE public.vcodes t SET ref_uuid_vendedore = vd.uuid_vendedore FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;
