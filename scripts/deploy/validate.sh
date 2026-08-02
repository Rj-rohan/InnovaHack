#!/bin/bash
set -e

echo "=== ValidateService: Running health checks ==="

wait_for() {
  local name=$1
  local url=$2
  local retries=18
  local wait=10
  for i in $(seq 1 $retries); do
    if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
      echo "  $name OK"
      return 0
    fi
    echo "  $name not ready (attempt $i/$retries), waiting ${wait}s..."
    sleep $wait
  done
  echo "  $name FAILED after $((retries * wait))s"
  return 1
}

wait_for "Next.js"     "http://localhost:3000/api/state"
wait_for "Python agent" "http://localhost:8000/health"

echo "=== All health checks passed ==="
