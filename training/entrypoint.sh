#!/bin/bash
set -e

# Install Python deps at runtime (avoids OOM during kaniko build)
# Persisted on /mnt so they survive container restarts
if [ ! -f /mnt/.deps-installed ]; then
    echo "=== Installing Python dependencies ==="
    pip install --no-cache-dir \
        unsloth \
        transformers \
        accelerate \
        datasets \
        requests \
        peft \
        wandb
    touch /mnt/.deps-installed
    echo "=== Dependencies installed ==="
fi

REPO_URL=${REPO_URL:-https://github.com/natask/moa-rl-env.git}
REPO_BRANCH=${REPO_BRANCH:-master}

if [ ! -d /mnt/repo ]; then
    git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" /mnt/repo
else
    cd /mnt/repo && git pull
fi

echo ""
echo "=== Shell ready. Training code at /mnt/repo/training ==="
echo "=== Run: cd /mnt/repo/training && python train.py      ==="
echo ""

# Keep container alive — use Northflank UI shell or: nf exec <service> -- bash
sleep infinity
