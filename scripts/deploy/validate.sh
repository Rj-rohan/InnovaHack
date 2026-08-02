#!/bin/bash
set -e

echo "=== ValidateService: Running health checks ==="

# Wait for services to be ready
sleep 10

# Check Next.js
echo "Checking Next.js..."
curl -sf http://localhost:3000/api/state | grep -q "deployed" \
  && echo "  Next.js OK" \
  || { echo "  Next.js FAILED"; exit 1; }

# Check Python agent
echo "Checking Python agent..."
curl -sf http://localhost:8000/health | grep -q "ok" \
  && echo "  Python agent OK" \
  || { echo "  Python agent FAILED"; exit 1; }

echo "=== All health checks passed ==="
