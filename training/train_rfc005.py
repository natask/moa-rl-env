"""
RFC 005 training loop — true interactive multi-turn GRPO.

The model generates one tool call at a time and sees tool results before
deciding the next move. This is what train.py can't do with standard GRPOTrainer.

How it works:
  1. rollout_wrapper.run_episode() runs N parallel episodes via vLLM
     - at each turn: generate → execute tool → inject result → continue
     - captures (context, completion, vllm_logprobs) per turn
  2. HF model re-scores each turn: forward pass on (context, completion)
     → differentiable token logprobs
  3. GRPO loss:
     advantage_i = (reward_i - mean_reward) / (std_reward + 1e-8)
     loss = -mean( advantage_i * sum(logprob of tokens in turn t, for all t in episode i) )
  4. optimizer.step()
  5. Unsloth syncs updated HF weights → vLLM automatically

The key upgrade over train.py:
  train.py   → model plans blind (generates all tool calls at once, never sees results)
  this file  → model reacts     (one call at a time, sees actual output each step)
"""

import os
import torch
import torch.nn.functional as F
import wandb
from concurrent.futures import ThreadPoolExecutor
from unsloth import FastLanguageModel

from rollout_wrapper import run_episode, Trajectory

wandb.init(
    project = "moa-rl-grpo",
    config  = {
        "model":      os.environ.get("MODEL_NAME", "unsloth/gpt-oss-20b-instruct"),
        "env_url":    os.environ.get("ENV_URL",    "https://http--moa-rl-env--7b2fgcxb6gxp.code.run"),
        "max_steps":  300,
        "n_episodes": int(os.environ.get("N_EPISODES", "4")),
        "approach":   "rfc005-interactive-multiturn",
    }
)

MODEL_NAME  = os.environ.get("MODEL_NAME",  "unsloth/gpt-oss-20b-instruct")
OUTPUT_DIR  = os.environ.get("OUTPUT_DIR",  "/output/moa-rl-grpo-rfc005")
N_EPISODES  = int(os.environ.get("N_EPISODES",  "4"))   # episodes per training step (GRPO needs variance)
MAX_STEPS   = int(os.environ.get("MAX_STEPS",   "300"))
LR          = float(os.environ.get("LR",        "5e-6"))


# ── model ──────────────────────────────────────────────────────────────────────

print(f"Loading {MODEL_NAME}...")
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name     = MODEL_NAME,
    max_seq_length = 4096,
    load_in_4bit   = False,
    dtype          = torch.bfloat16,
)
model = FastLanguageModel.get_peft_model(
    model,
    r                        = 16,
    lora_alpha               = 16,
    target_modules           = ["q_proj", "k_proj", "v_proj", "o_proj",
                                 "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing = "unsloth",
    random_state             = 42,
)

# Start vLLM inside Unsloth (syncs weights automatically after each optimizer step)
from unsloth import PatchFastRL
PatchFastRL("GRPO", FastLanguageModel)

optimizer = torch.optim.AdamW(model.parameters(), lr=LR)


# ── GRPO loss over a trajectory ────────────────────────────────────────────────

def score_turn(messages: list[dict], completion: str) -> torch.Tensor:
    """
    Re-score one turn with the HF model to get differentiable token logprobs.

    vLLM logprobs are used for episode collection (fast generation).
    HF logprobs are used here for the actual gradient update.
    """
    # Build input: format messages as a single string the model was trained on
    prompt_text = tokenizer.apply_chat_template(
        messages,
        tokenize          = False,
        add_generation_prompt = True,
    )
    full_text = prompt_text + completion

    inputs     = tokenizer(full_text,    return_tensors="pt").to(model.device)
    prompt_ids = tokenizer(prompt_text,  return_tensors="pt")["input_ids"]
    prompt_len = prompt_ids.shape[1]

    with torch.no_grad() if not model.training else torch.enable_grad():
        logits = model(**inputs).logits  # (1, seq_len, vocab)

    # Only score the completion tokens (not the prompt)
    comp_logits = logits[0, prompt_len - 1 : -1, :]   # (comp_len, vocab)
    comp_ids    = inputs["input_ids"][0, prompt_len:]  # (comp_len,)

    log_probs   = F.log_softmax(comp_logits, dim=-1)
    token_lps   = log_probs[range(len(comp_ids)), comp_ids]
    return token_lps.sum()   # scalar: total logprob of this completion


def grpo_loss(trajectories: list[Trajectory]) -> torch.Tensor:
    """
    Compute GRPO loss across N trajectories.

    advantage_i = (reward_i - mean) / (std + 1e-8)
    loss = -mean_i( advantage_i * sum_t( logprob(turn t in episode i) ) )
    """
    rewards  = torch.tensor([t.reward for t in trajectories], dtype=torch.float32)
    mean_r   = rewards.mean()
    std_r    = rewards.std() + 1e-8
    advantages = (rewards - mean_r) / std_r

    losses = []
    for traj, adv in zip(trajectories, advantages):
        # Sum logprobs across all turns in this episode
        total_lp = sum(
            score_turn(turn.messages, turn.completion)
            for turn in traj.turns
        )
        losses.append(-adv * total_lp)

    return torch.stack(losses).mean()


# ── training loop ──────────────────────────────────────────────────────────────

print(f"RFC 005 training: {N_EPISODES} episodes/step × {MAX_STEPS} steps")
print(f"Model: {MODEL_NAME}  →  {OUTPUT_DIR}")

for step in range(MAX_STEPS):
    model.train()

    # Collect N episodes in parallel via vLLM
    with ThreadPoolExecutor(max_workers=N_EPISODES) as pool:
        trajectories = list(pool.map(lambda _: run_episode(), range(N_EPISODES)))

    rewards = [t.reward for t in trajectories]
    mean_r  = sum(rewards) / len(rewards)

    # GRPO loss + optimizer step
    loss = grpo_loss(trajectories)
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
    optimizer.step()

    # Unsloth automatically syncs updated weights → vLLM after optimizer.step()

    wandb.log({
        "loss":         loss.item(),
        "reward/mean":  mean_r,
        "reward/max":   max(rewards),
        "reward/min":   min(rewards),
    }, step=step)

    print(
        f"step {step+1:4d}/{MAX_STEPS} | "
        f"loss {loss.item():.4f} | "
        f"rewards {[f'{r:.2f}' for r in rewards]} | "
        f"mean {mean_r:.3f}"
    )

    if (step + 1) % 50 == 0:
        model.save_pretrained(f"{OUTPUT_DIR}/step-{step+1}")
        tokenizer.save_pretrained(f"{OUTPUT_DIR}/step-{step+1}")
        print(f"  → checkpoint saved")

model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"Done. Saved to {OUTPUT_DIR}")
