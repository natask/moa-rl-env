#!/bin/bash
set -e

REPO_URL=${REPO_URL:-https://github.com/natask/moa-rl-env.git}
REPO_BRANCH=${REPO_BRANCH:-master}

if [ ! -d /app/repo ]; then
    git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" /app/repo
else
    cd /app/repo && git pull
fi

echo ""
echo "=== Shell ready. Training code at /app/repo/training ==="
echo "=== Run: cd /app/repo/training && python train.py      ==="
echo ""

# Keep container alive — use Northflank UI shell or: nf exec <service> -- bash
sleep infinity
