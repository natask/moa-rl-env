FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-devel

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip

# vLLM 0.7.3 is tested against torch 2.5.x — this base image matches
RUN pip install --no-cache-dir \
    "vllm==0.7.3" \
    unsloth \
    transformers \
    accelerate \
    datasets \
    requests \
    peft \
    wandb

# TRL pinned to compat range for vllm 0.7.3
RUN pip install --upgrade --no-cache-dir "trl>=0.12.0,<0.16.0"

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Iteration loop:
#   1. Northflank shell (UI or: nf exec <service> -- bash)
#   2. cd /app/repo/training
#   3. git pull && python train.py
CMD ["/entrypoint.sh"]
