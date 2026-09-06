#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Building and starting Docker Compose stack ==="
docker compose up -d --build

echo "=== 2. Verifying migration container finished successfully ==="
MIGRATION_STATUS=$(docker compose ps -a migration --format '{{.State}}')
MIGRATION_EXIT=$(docker compose ps -a migration --format '{{.ExitCode}}')

if [ "$MIGRATION_EXIT" != "0" ]; then
  echo "ERROR: Migration container failed with exit code $MIGRATION_EXIT!"
  docker compose logs migration
  docker compose down -v
  exit 1
fi
echo "Migration completed cleanly (Exit code 0)."

echo "=== 3. Waiting for API container healthcheck ==="
MAX_RETRIES=20
COUNT=0
HEALTHY=false

while [ $COUNT -lt $MAX_RETRIES ]; do
  STATUS=$(docker compose ps api --format '{{.Health}}')
  if [ "$STATUS" = "healthy" ]; then
    HEALTHY=true
    break
  fi
  echo "Waiting for API to report healthy... ($((COUNT + 1))/$MAX_RETRIES)"
  sleep 2
  COUNT=$((COUNT + 1))
done

if [ "$HEALTHY" != "true" ]; then
  echo "ERROR: API container failed to become healthy in time!"
  docker compose logs api
  docker compose down -v
  exit 1
fi
echo "API is healthy."

echo "=== 4. Testing End-to-End API Registration & Health ==="
# Test health route
HEALTH_RESP=$(curl -s http://localhost:3000/api/v1/health)
if [[ "$HEALTH_RESP" != *'"status":"ok"'* ]]; then
  echo "ERROR: Unexpected response from /health: $HEALTH_RESP"
  docker compose down -v
  exit 1
fi
echo "Health route verified: $HEALTH_RESP"

# Test signup route
SIGNUP_RESP=$(curl -s -X POST http://localhost:3000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"smoke_test_user","password":"Password123"}')

if [[ "$SIGNUP_RESP" != *'"success":true'* ]]; then
  echo "ERROR: Unexpected signup response: $SIGNUP_RESP"
  docker compose down -v
  exit 1
fi
echo "Signup route verified: User created."

echo "=== 5. Tearing down stack and cleaning volumes ==="
docker compose down -v

echo "=== All Docker Smoke Tests Passed Successfully ==="