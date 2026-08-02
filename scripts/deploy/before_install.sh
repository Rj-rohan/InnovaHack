#!/bin/bash
set -e

echo "=== BeforeInstall: Installing system dependencies ==="

# Install Node.js 20
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Install Python 3.11
if ! command -v python3.11 &> /dev/null; then
  apt-get update
  apt-get install -y python3.11 python3.11-venv python3-pip
fi

# Install git if not present
apt-get install -y git curl

# Clean previous deployment if exists
if [ -d /home/ubuntu/killswitch ]; then
  echo "Removing previous deployment..."
  rm -rf /home/ubuntu/killswitch
fi

mkdir -p /home/ubuntu/killswitch
chown -R ubuntu:ubuntu /home/ubuntu/killswitch

echo "=== BeforeInstall complete ==="
