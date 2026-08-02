#!/bin/bash
set -e

APP_DIR=/home/ubuntu/killswitch
echo "=== AfterInstall: Setting up application ==="

# --- Client (Next.js) ---
echo "Installing client dependencies..."
cd $APP_DIR/client
npm ci --omit=dev

# --- Server (Python) ---
echo "Setting up Python virtual environment..."
cd $APP_DIR/server
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# --- Contracts (Hardhat) ---
echo "Installing contract dependencies..."
cd $APP_DIR/contracts
npm ci

# --- Deploy local chain contracts ---
echo "Starting temporary Hardhat node for deployment..."
npm run node &
HARDHAT_PID=$!
sleep 5

echo "Deploying contracts..."
npm run deploy:local

echo "Stopping temporary Hardhat node..."
kill $HARDHAT_PID || true
sleep 2

# --- Sync chain addresses to client ---
echo "Syncing chain addresses..."
cd $APP_DIR/client
node scripts/sync-chain.mjs

# --- Init database indexes ---
echo "Initialising MongoDB indexes..."
npm run db:init

echo "=== AfterInstall complete ==="
