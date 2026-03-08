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

# Code is pulled fresh at startup — push to GitHub, restart container, done.
# No Docker rebuild needed for code changes.
ENV REPO_URL=https://github.com/natask/moa-rl-env.git
ENV REPO_BRANCH=master

CMD bash -c "git clone --depth=1 --branch $REPO_BRANCH $REPO_URL /app/repo && cd /app/repo/training && python train.py"
