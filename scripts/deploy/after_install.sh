#!/bin/bash
set -e

APP_DIR=/home/ubuntu/killswitch
echo "=== AfterInstall: Setting up application ==="

# Remove stale Next.js build so old chunks don't persist alongside new ones
rm -rf $APP_DIR/client/.next

# --- Client (Next.js) ---
echo "Installing client dependencies..."
cd $APP_DIR/client
NODE_OPTIONS="--max-old-space-size=512" npm ci --omit=dev

echo "Building Next.js client..."
NODE_OPTIONS="--max-old-space-size=1536" npm run build

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
npm run node > /tmp/hardhat-install.log 2>&1 &
HARDHAT_PID=$!
sleep 5

echo "Deploying contracts..."
npm run deploy:local > /tmp/hardhat-deploy.log 2>&1

echo "Stopping temporary Hardhat node..."
kill $HARDHAT_PID 2>/dev/null || true
wait $HARDHAT_PID 2>/dev/null || true

# --- Sync chain addresses to client ---
echo "Syncing chain addresses..."
cd $APP_DIR/client
node scripts/sync-chain.mjs

# --- Init database indexes ---
echo "Initialising MongoDB indexes..."
npm run db:init

# Fix ownership so ubuntu user owns everything including installed deps
chown -R ubuntu:ubuntu $APP_DIR

echo "=== AfterInstall complete ==="
