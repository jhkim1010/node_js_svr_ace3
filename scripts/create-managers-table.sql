-- Managers 테이블 생성 스크립트
-- PostgreSQL 데이터베이스에서 실행하세요

CREATE TABLE IF NOT EXISTS public.managers (
    manager_name VARCHAR(100) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    allowed_reports JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
);

-- 인덱스 생성
CREATE UNIQUE INDEX IF NOT EXISTS managers_manager_name_idx ON public.managers(manager_name);

-- 코멘트 추가
COMMENT ON TABLE public.managers IS '관리자 인증 및 권한 관리 테이블';
COMMENT ON COLUMN public.managers.manager_name IS '관리자 이름 (고유)';
COMMENT ON COLUMN public.managers.password_hash IS 'bcrypt로 해시화된 비밀번호';
COMMENT ON COLUMN public.managers.allowed_reports IS '접근 가능한 보고서 목록 (JSON 배열). 빈 배열이면 모든 보고서 접근 가능';
COMMENT ON COLUMN public.managers.is_active IS '계정 활성화 여부';

