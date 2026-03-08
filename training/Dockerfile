FROM pytorch/pytorch:2.8.0-cuda12.6-cudnn9-devel

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip

# Install vllm, unsloth, and base deps first
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
COPY train.py .
COPY train_rfc005.py .
COPY rollout_wrapper.py .

CMD ["python", "train.py"]
