#!/bin/bash
set -e

APP_DIR=/home/ubuntu/killswitch
LOG_DIR=/home/ubuntu/logs
mkdir -p $LOG_DIR

echo "=== ApplicationStart: Starting all services ==="

# --- 1. Hardhat node (local chain) ---
echo "Starting Hardhat node..."
cd $APP_DIR/contracts
nohup npm run node > $LOG_DIR/hardhat.log 2>&1 &
echo $! > /tmp/hardhat.pid
sleep 5

# --- 2. Deploy contracts against the running node ---
echo "Deploying contracts..."
npm run deploy:local >> $LOG_DIR/hardhat.log 2>&1

# --- 3. Sync chain addresses ---
echo "Syncing chain addresses..."
cd $APP_DIR/client
node scripts/sync-chain.mjs >> $LOG_DIR/client.log 2>&1

# --- 4. Next.js client ---
echo "Starting Next.js..."
cd $APP_DIR/client
nohup npm run start > $LOG_DIR/client.log 2>&1 &
echo $! > /tmp/nextjs.pid
sleep 3

# --- 5. Chain indexer ---
echo "Starting chain indexer..."
cd $APP_DIR/client
nohup npm run indexer > $LOG_DIR/indexer.log 2>&1 &
echo $! > /tmp/indexer.pid

# --- 6. Python agent ---
echo "Starting Python agent..."
cd $APP_DIR/server
nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 > $LOG_DIR/server.log 2>&1 &
echo $! > /tmp/server.pid

echo "=== All services started ==="
echo "  Hardhat  PID: $(cat /tmp/hardhat.pid)"
echo "  Next.js  PID: $(cat /tmp/nextjs.pid)"
echo "  Indexer  PID: $(cat /tmp/indexer.pid)"
echo "  Server   PID: $(cat /tmp/server.pid)"
