#!/bin/bash

echo "=== ApplicationStop: Stopping all services ==="

stop_pid() {
  local name=$1
  local pidfile=$2
  if [ -f "$pidfile" ]; then
    PID=$(cat $pidfile)
    if kill -0 $PID 2>/dev/null; then
      echo "Stopping $name (PID $PID)..."
      kill $PID
      sleep 2
      kill -9 $PID 2>/dev/null || true
    fi
    rm -f $pidfile
  else
    echo "$name not running (no pidfile)"
  fi
}

stop_pid "Python agent"   /tmp/server.pid
stop_pid "Chain indexer"  /tmp/indexer.pid
stop_pid "Next.js"        /tmp/nextjs.pid
stop_pid "Hardhat node"   /tmp/hardhat.pid

# Kill any stragglers by port
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 8550/tcp 2>/dev/null || true

echo "=== ApplicationStop complete ==="
