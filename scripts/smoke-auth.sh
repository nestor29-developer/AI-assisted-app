#!/usr/bin/env bash
# Exercises the auth API end to end with curl and a cookie jar.
# Usage: BASE_URL=http://localhost:3000 scripts/smoke-auth.sh
# Note: auth endpoints allow ~10 attempts per minute per IP, so avoid looping this script.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"
PASSWORD='smoke-test-password-1'
JAR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$JAR" "$BODY"' EXIT

# req METHOD PATH EXPECTED_STATUS [JSON_BODY] [extra curl args...]
req() {
  local method=$1 path=$2 expected=$3 json=${4:-}
  shift 4 || shift $#
  local args=(-sS -o "$BODY" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" -H 'accept: application/json')
  [[ -n $json ]] && args+=(-H 'content-type: application/json' --data "$json")
  local status
  status=$(curl "${args[@]}" "$@" "$BASE_URL$path")
  if [[ $status != "$expected" ]]; then
    echo "FAIL  $method $path: expected $expected, got $status"
    cat "$BODY"; echo
    exit 1
  fi
  printf 'ok    %-6s %-26s -> %s\n' "$method" "$path" "$status"
}

creds="{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"

req GET  /api/v1/health          200
req GET  /api/v1/health/ready    200
req GET  /api/v1/auth/me         401
req POST /api/v1/auth/register   400 '{"email":"not-an-email","password":"short"}'
req POST /api/v1/auth/register   201 "$creds"
req GET  /api/v1/auth/me         200
req POST /api/v1/auth/register   409 "$creds"
req POST /api/v1/auth/logout     204 ''
req GET  /api/v1/auth/me         401
req POST /api/v1/auth/login      401 "{\"email\":\"$EMAIL\",\"password\":\"wrong-password-1\"}"
req POST /api/v1/auth/login      200 "$creds"
req GET  /api/v1/auth/me         200
req POST /api/v1/auth/login      403 "$creds" -H 'origin: https://evil.example'
echo "All auth checks passed for $EMAIL"
