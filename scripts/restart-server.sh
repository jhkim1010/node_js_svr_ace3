#!/bin/bash

# 서버 재시작 스크립트
# 원격 서버에서 실행: bash scripts/restart-server.sh

set -e

echo "🔍 서버 상태 확인 중..."

# 프로젝트 디렉토리로 이동 (필요시 경로 수정)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "📁 프로젝트 디렉토리: $PROJECT_DIR"

# Docker 컨테이너 확인
if docker ps -a | grep -q syncace; then
    echo "✅ syncace 컨테이너 발견"
    
    # 컨테이너가 실행 중인지 확인
    if docker ps | grep -q syncace; then
        echo "⚠️  컨테이너가 이미 실행 중입니다. 재시작합니다..."
        docker restart syncace
    else
        echo "🚀 중지된 컨테이너를 시작합니다..."
        docker start syncace
    fi
else
    echo "📦 Docker Compose로 컨테이너를 시작합니다..."
    if command -v docker-compose &> /dev/null; then
        docker-compose up -d
    elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
        docker compose up -d
    else
        echo "❌ docker-compose를 찾을 수 없습니다."
        exit 1
    fi
fi

# 잠시 대기
echo "⏳ 서버 시작 대기 중 (5초)..."
sleep 5

# 상태 확인
echo ""
echo "📊 컨테이너 상태:"
docker ps | grep syncace || echo "⚠️  컨테이너가 실행되지 않았습니다."

# 포트 확인
echo ""
echo "🔌 포트 3030 확인:"
if lsof -i :3030 &> /dev/null || netstat -tlnp 2>/dev/null | grep -q :3030; then
    echo "✅ 포트 3030이 열려있습니다."
else
    echo "⚠️  포트 3030이 열려있지 않습니다."
fi

# 헬스체크
echo ""
echo "🏥 헬스체크:"
if curl -s http://localhost:3030/api/health > /dev/null; then
    echo "✅ 서버가 정상적으로 응답합니다."
    curl -s http://localhost:3030/api/health | head -5
else
    echo "❌ 서버가 응답하지 않습니다."
    echo ""
    echo "📋 최근 로그:"
    docker logs --tail 20 syncace 2>&1 || echo "로그를 가져올 수 없습니다."
fi

echo ""
echo "✅ 완료!"

