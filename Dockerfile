FROM ghcr.io/meta-pytorch/openenv-base:latest

# Install node 20 + npm
RUN apt-get update && apt-get install -y curl make g++ python3 && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy moav2 source and pre-install all dependencies once
# (node_modules will be symlinked into per-request sandboxes — no 700MB copy per reset)
COPY moav2/ /app/moav2/
RUN cd /app/moav2 && npm install --no-audit --no-fund

# Copy env server
COPY src/core/ /app/src/core/
COPY src/envs/moa_env/ /app/src/envs/moa_env/

WORKDIR /app/src

ENV ENABLE_WEB_INTERFACE=true
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "envs.moa_env.server.app:app", "--host", "0.0.0.0", "--port", "8000"]
