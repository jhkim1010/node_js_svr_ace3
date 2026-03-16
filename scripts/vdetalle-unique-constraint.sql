-- vdetalle 테이블 unique 제약: (sucursal, id_vdetalle)
-- insert/update 결정은 이 제약으로, skip/update 결정은 utime 기준으로 앱에서 처리합니다.
--
-- 기존에 (id_vdetalle, sucursal, ref_id_vcode) 등 다른 unique 제약이 있으면 먼저 제거 후 실행하세요.
-- 예: ALTER TABLE public.vdetalle DROP CONSTRAINT IF EXISTS vdetalle_id_uniq;

ALTER TABLE public.vdetalle
ADD CONSTRAINT vdetalle_unique UNIQUE (sucursal, id_vdetalle);
