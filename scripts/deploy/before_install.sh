#!/bin/bash
set -e

echo "=== BeforeInstall: Installing system dependencies ==="

# Purge broken package records left by CodeDeploy agent self-installer and
# any conflicting curl/libcurl packages before touching apt further.
dpkg --remove --force-remove-reinstreq codedeploy-agent 2>/dev/null || true
dpkg --remove --force-remove-reinstreq curl 2>/dev/null || true
dpkg --remove --force-remove-reinstreq libcurl4t64 2>/dev/null || true
dpkg --configure -a 2>/dev/null || true
apt-get clean
apt-get update

# Reinstall curl cleanly now that conflicts are cleared
apt-get install -y curl

# Install Node.js 20 via nodesource
if ! command -v node &> /dev/null || [[ "$(node --version)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Install Python 3.11
if ! command -v python3.11 &> /dev/null; then
  apt-get install -y python3.11 python3.11-venv python3-pip
fi

apt-get install -y git

# Clean previous deployment if exists
if [ -d /home/ubuntu/killswitch ]; then
  echo "Removing previous deployment..."
  rm -rf /home/ubuntu/killswitch
fi

mkdir -p /home/ubuntu/killswitch
chown -R ubuntu:ubuntu /home/ubuntu/killswitch

echo "=== BeforeInstall complete ==="
