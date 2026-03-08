"""
GRPO training on MOA RL environment — gpt-oss 20B BF16 on H100.

Multi-turn tool-using training:
  The model generates a sequence of tool calls (read/edit/bash/submit) in one pass.
  The reward function executes them against the env and returns tests_passed/tests_total.

  This works with standard Unsloth GRPO (use_vllm=True) because:
  - Unsloth manages local vLLM for fast rollouts
  - Unsloth syncs weights HF ↔ vLLM after each batch automatically
  - The reward function executes the tool call sequence and scores it
  - Model learns: "from these user words, generate tool calls that pass tests"
"""

import unsloth  # must be first to apply all optimizations
import json
import os
import re
import requests
import torch
import wandb
from datasets import Dataset
from trl import GRPOTrainer, GRPOConfig
from unsloth import FastLanguageModel

wandb.init(
    project = "moa-rl-grpo",
    mode    = "online" if os.environ.get("WANDB_API_KEY") else "disabled",
    config  = {
        "model":      os.environ.get("MODEL_NAME", "unsloth/gpt-oss-20b"),
        "env_url":    os.environ.get("ENV_URL",    "https://http--moa-rl-env--7b2fgcxb6gxp.code.run"),
        "max_steps":  300,
        "num_generations": 4,
        "approach":   "single-completion-plan",
    }
)

ENV_URL    = os.environ.get("ENV_URL", "https://http--moa-rl-env--7b2fgcxb6gxp.code.run")
MODEL_NAME = os.environ.get("MODEL_NAME", "unsloth/gpt-oss-20b")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/output/moa-rl-grpo")
TIMEOUT    = 120
MAX_STEPS  = 8   # tool calls per episode


# ── env helpers ────────────────────────────────────────────────────────────────

def env_reset() -> dict:
    r = requests.post(f"{ENV_URL}/reset", json={}, timeout=TIMEOUT)
    r.raise_for_status()
    raw = r.json()
    obs = raw.get("observation", raw)
    obs["reward"] = raw.get("reward", 0.0)
    return obs

def env_step(tool: str, params: dict) -> dict:
    r = requests.post(
        f"{ENV_URL}/step",
        json={"action": {"tool": tool, "params": params}},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    raw = r.json()
    obs = raw.get("observation", raw)
    obs["reward"] = raw.get("reward", 0.0)
    return obs


# ── prompt format ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are a TypeScript coding agent. You fix broken source files using tools.

Available tools — emit each as a JSON object on its own line:
  {"tool": "read",   "params": {"path": "src/foo.ts"}}
  {"tool": "edit",   "params": {"path": "src/foo.ts", "old_string": "...", "new_string": "..."}}
  {"tool": "bash",   "params": {"cmd": "npx tsc --noEmit 2>&1 | head -10"}}
  {"tool": "submit", "params": {}}

Rules:
- Always read the file first to understand its current state.
- Edit the file to implement the required functionality.
- Optionally use bash to verify compilation.
- Always end with submit to trigger the test suite.
- Emit tool calls ONLY — no prose, no markdown fences.
"""

def build_prompt(obs: dict) -> str:
    user_msgs = obs.get("user_messages", [])
    user_context = ""
    if user_msgs:
        user_context = "User messages that triggered this task:\n"
        user_context += "\n".join(f"  > {m}" for m in user_msgs) + "\n\n"

    return (
        f"{user_context}"
        f"Task: {obs['task']}\n\n"
        f"File to fix: {obs['broken_file_path']}\n\n"
        "Tests that must pass:\n"
        f"```ts\n{obs.get('test_file_content', '')[:2000]}\n```\n\n"
        "Generate tool calls to fix the file and submit:"
    )


# ── dataset ────────────────────────────────────────────────────────────────────

print(f"Building dataset from {ENV_URL}...")
rows = []
for _ in range(32):   # 32 prompts, GRPO generates N completions each
    obs = env_reset()
    rows.append({
        "prompt": build_prompt(obs),
        "task_id": obs.get("task", ""),
        "file_path": obs.get("broken_file_path", ""),
    })

dataset = Dataset.from_list(rows)
print(f"Dataset: {len(dataset)} prompts")


# ── reward function ────────────────────────────────────────────────────────────

def _parse_tool_calls(text: str) -> list[dict]:
    """Extract JSON tool call objects from model output."""
    calls = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
            if "tool" in obj and "params" in obj:
                calls.append(obj)
        except json.JSONDecodeError:
            pass
    return calls

def _text(completion) -> str:
    if isinstance(completion, str):
        return completion
    if isinstance(completion, list):
        return "".join(
            c["content"] if isinstance(c, dict) else str(c)
            for c in completion
        )
    return str(completion)

def reward_fn(completions, file_path, **kwargs) -> list[float]:
    """
    Execute each completion's tool call sequence against the env.
    Returns reward = tests_passed / tests_total (0.0–1.0).
    """
    rewards = []
    for completion, fp in zip(completions, file_path):
        text = _text(completion)
        calls = _parse_tool_calls(text)

        if not calls:
            rewards.append(0.0)
            continue

        try:
            # Fresh episode for each completion
            env_reset()
            reward = 0.0

            for call in calls[:MAX_STEPS]:
                tool   = call.get("tool", "")
                params = call.get("params", {})
                obs    = env_step(tool, params)
                reward = obs.get("reward", 0.0)
                if obs.get("done", False):
                    break

            # If model never submitted, force submit to get a score
            if not any(c.get("tool") == "submit" for c in calls):
                obs    = env_step("submit", {})
                reward = obs.get("reward", 0.0)

            rewards.append(reward)

        except Exception as e:
            print(f"reward_fn error: {e}")
            rewards.append(0.0)

    wandb.log({
        "reward/mean":  sum(rewards) / len(rewards),
        "reward/max":   max(rewards),
        "reward/min":   min(rewards),
    })
    return rewards


# ── model ──────────────────────────────────────────────────────────────────────

print(f"Loading {MODEL_NAME}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=MODEL_NAME,
    max_seq_length=4096,
    load_in_4bit=False,
    dtype=torch.bfloat16,
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
    random_state=42,
)


# ── training ───────────────────────────────────────────────────────────────────

trainer = GRPOTrainer(
    model=model,
    processing_class=tokenizer,
    reward_funcs=[reward_fn],
    args=GRPOConfig(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        num_generations=4,          # 4 completions per prompt → GRPO needs variance
        max_completion_length=1024, # enough for 8 tool calls
        learning_rate=5e-6,
        logging_steps=1,
        save_steps=50,
        max_steps=300,
        bf16=True,
        use_vllm=False,             # vLLM disabled: gpt_oss.py weight_name kwarg mismatch on 0.12.x
    ),
    train_dataset=dataset,
)

print(f"Training against {ENV_URL}")
print(f"Model: {MODEL_NAME}  Output: {OUTPUT_DIR}")
trainer.train()
trainer.save_model(OUTPUT_DIR)
print(f"Done. Saved to {OUTPUT_DIR}")
