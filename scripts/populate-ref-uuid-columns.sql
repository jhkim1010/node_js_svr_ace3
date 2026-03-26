-- ref_uuid_* 컬럼에 값 배당 (ref_id_* 와 t1.uuid_{t1} 조인)
-- clientes 참조: ref_id_cliente 는 clientes.id 와 비교하여 uuid_cliente 배당.
-- 실행 전 ref_uuid_* 컬럼이 이미 추가되어 있어야 함 (add-ref-uuid-columns.sql 1단계 또는 전체 실행 후).

-- ========== vdetalle ==========
UPDATE public.vdetalle t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

UPDATE public.vdetalle t SET ref_uuid_codigo = c.uuid_codigo
  FROM public.codigos c WHERE t.ref_id_codigo = c.id_codigo AND t.ref_uuid_codigo IS NULL;

UPDATE public.vdetalle t SET ref_uuid_todocodigo = tc.uuid_todocodigo
  FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;

UPDATE public.vdetalle t SET ref_uuid_vendedore = vd.uuid_vendedore
  FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;

UPDATE public.vdetalle t SET ref_uuid_cliente = cl.uuid_cliente
  FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- ========== creditoventas ==========
UPDATE public.creditoventas t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

UPDATE public.creditoventas t SET ref_uuid_cliente = cl.uuid_cliente
  FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- ========== fventas ==========
UPDATE public.fventas t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

-- ========== vtags ==========
UPDATE public.vtags t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

UPDATE public.vtags t SET ref_uuid_cuenta = cu.uuid_cuenta
  FROM public.cuentas cu WHERE t.ref_id_cuenta = cu.id_cuenta AND t.ref_uuid_cuenta IS NULL;

-- ========== ingresos ==========
UPDATE public.ingresos t SET ref_uuid_codigo = c.uuid_codigo
  FROM public.codigos c WHERE t.ref_id_codigo = c.id_codigo AND t.ref_uuid_codigo IS NULL;

UPDATE public.ingresos t SET ref_uuid_todocodigo = tc.uuid_todocodigo
  FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;

-- ========== senias_vinculados ==========
UPDATE public.senias_vinculados t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

UPDATE public.senias_vinculados t SET ref_uuid_cliente = cl.uuid_cliente
  FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

-- ========== online_ventas ==========
UPDATE public.online_ventas t SET ref_uuid_vcode = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode = v.vcode_id AND t.ref_uuid_vcode IS NULL;

UPDATE public.online_ventas t SET ref_uuid_vcode_pagado = v.uuid_vcode
  FROM public.vcodes v WHERE t.ref_id_vcode_pagado = v.vcode_id AND t.ref_uuid_vcode_pagado IS NULL;

-- ========== codigos ==========
UPDATE public.codigos t SET ref_uuid_todocodigo = tc.uuid_todocodigo
  FROM public.todocodigos tc WHERE t.ref_id_todocodigo = tc.id_todocodigo AND t.ref_uuid_todocodigo IS NULL;

UPDATE public.codigos t SET ref_uuid_color = co.uuid_color
  FROM public.color co WHERE t.ref_id_color = co.id_color AND t.ref_uuid_color IS NULL;

UPDATE public.codigos t SET ref_uuid_temporada = tm.uuid_temporada
  FROM public.temporadas tm WHERE t.ref_id_temporada = tm.id_temporada AND t.ref_uuid_temporada IS NULL;

-- ========== todocodigos ==========
UPDATE public.todocodigos t SET ref_uuid_temporada = tm.uuid_temporada
  FROM public.temporadas tm WHERE t.ref_id_temporada = tm.id_temporada AND t.ref_uuid_temporada IS NULL;

UPDATE public.todocodigos t SET ref_uuid_tipo = tp.uuid_tipo
  FROM public.tipos tp WHERE t.ref_id_tipo = tp.id_tipo AND t.ref_uuid_tipo IS NULL;

-- ========== clientes ==========
UPDATE public.clientes t SET ref_uuid_vendedore = vd.uuid_vendedore
  FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;

-- ========== vcodes ==========
UPDATE public.vcodes t SET ref_uuid_cliente = cl.uuid_cliente
  FROM public.clientes cl WHERE t.ref_id_cliente = cl.id AND t.ref_uuid_cliente IS NULL;

UPDATE public.vcodes t SET ref_uuid_vendedore = vd.uuid_vendedore
  FROM public.vendedores vd WHERE t.ref_id_vendedor = vd.vid AND t.ref_uuid_vendedore IS NULL;
