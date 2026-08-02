#!/bin/bash
set -e

echo "=== BeforeInstall: Installing system dependencies ==="

# Add swap if not already present (prevents OOM kills on small instances)
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

# Free disk space before installing packages
apt-get clean
rm -rf /var/cache/apt/archives/*.deb /tmp/* /var/tmp/*
journalctl --vacuum-size=50M 2>/dev/null || true

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

# Install Node.js 22 via nodesource
if ! command -v node &> /dev/null || [[ "$(node --version)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Install python3-venv for whatever python3 version is present
apt-get install -y python3-venv python3-pip

apt-get install -y git

# Clean previous deployment if exists
if [ -d /home/ubuntu/killswitch ]; then
  echo "Removing previous deployment..."
  rm -rf /home/ubuntu/killswitch
fi

mkdir -p /home/ubuntu/killswitch
chown -R ubuntu:ubuntu /home/ubuntu/killswitch

echo "=== BeforeInstall complete ==="
