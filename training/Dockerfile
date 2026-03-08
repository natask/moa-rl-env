FROM pytorch/pytorch:2.8.0-cuda12.6-cudnn9-devel

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN pip install --upgrade pip

# Pin vLLM to version TRL supports, install unsloth
RUN pip install --no-cache-dir \
    "vllm==0.12.0" \
    unsloth \
    "trl>=0.16.0" \
    transformers \
    accelerate \
    datasets \
    requests \
    peft \
    wandb

WORKDIR /app
COPY train.py .
COPY train_rfc005.py .
COPY rollout_wrapper.py .

CMD ["python", "train.py"]
