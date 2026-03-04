#!/bin/bash

# GET /api/resumen_del_dia 샘플 요청 스크립트
# 사용법: ./resumen_del_dia_curl_example.sh

# 기본 설정 (실제 값으로 변경하세요)
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="my_database"
DB_USER="postgres"
DB_PASSWORD="your_password"
DB_SSL="false"

# 서버 URL
SERVER_URL="http://localhost:3030"

# 날짜 파라미터 (선택사항, 주석 해제하여 사용)
# FECHA="2024-01-15"

# 기본 요청 (오늘 날짜 사용)
echo "=== 기본 요청 (오늘 날짜) ==="
curl -X GET "${SERVER_URL}/api/resumen_del_dia" \
  -H "x-db-host: ${DB_HOST}" \
  -H "x-db-port: ${DB_PORT}" \
  -H "x-db-name: ${DB_NAME}" \
  -H "x-db-user: ${DB_USER}" \
  -H "x-db-password: ${DB_PASSWORD}" \
  -H "x-db-ssl: ${DB_SSL}" \
  -H "Content-Type: application/json" \
  | jq '.'

echo -e "\n"

# 특정 날짜 지정 요청 (fecha 파라미터 사용)
if [ -n "$FECHA" ]; then
  echo "=== 특정 날짜 지정 요청 (${FECHA}) ==="
  curl -X GET "${SERVER_URL}/api/resumen_del_dia?fecha=${FECHA}" \
    -H "x-db-host: ${DB_HOST}" \
    -H "x-db-port: ${DB_PORT}" \
    -H "x-db-name: ${DB_NAME}" \
    -H "x-db-user: ${DB_USER}" \
    -H "x-db-password: ${DB_PASSWORD}" \
    -H "x-db-ssl: ${DB_SSL}" \
    -H "Content-Type: application/json" \
    | jq '.'
fi

