FROM pytorch/pytorch:2.8.0-cuda12.6-cudnn9-devel

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip

# Deps baked into image — only rebuild when these change
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
