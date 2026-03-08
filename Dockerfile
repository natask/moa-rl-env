FROM ghcr.io/meta-pytorch/openenv-base:latest

# Install node for running vitest
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*

COPY src/core/ /app/src/core/
COPY src/envs/moa_env/ /app/src/envs/moa_env/

WORKDIR /app/src

ENV ENABLE_WEB_INTERFACE=true
HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "envs.moa_env.server.app:app", "--host", "0.0.0.0", "--port", "8000"]
