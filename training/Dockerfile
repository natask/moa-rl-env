FROM pytorch/pytorch:2.8.0-cuda12.6-cudnn9-devel

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip

# Install vllm, unsloth, and base deps first
RUN pip install --no-cache-dir \
    "vllm==0.12.0" \
    unsloth \
    transformers \
    accelerate \
    datasets \
    requests \
    peft \
    wandb

# Install TRL last with --upgrade so it is not pinned down by unsloth deps
# trl>=0.16 dropped the GuidedDecodingParams import that broke on vllm 0.12
RUN pip install --upgrade --no-cache-dir "trl>=0.16.0"

WORKDIR /app
COPY train.py .
COPY train_rfc005.py .
COPY rollout_wrapper.py .

CMD ["python", "train.py"]
