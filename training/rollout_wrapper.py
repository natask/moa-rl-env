"""
RFC 005 interactive rollout wrapper.

Runs a full multi-turn episode where the model sees tool results at each step.
Unlike the single-completion approach in train.py, the model:
  - generates ONE tool call at a time
  - sees the actual result before deciding the next move
  - is reactive, not planning blind

Returns a Trajectory: list of (context, completion, logprobs) per turn + final reward.
The training loop re-scores each turn with the HF model to get differentiable logprobs
and computes GRPO loss across the full trajectory.
"""

import json
import os
import requests
from dataclasses import dataclass, field

ENV_URL    = os.environ.get("ENV_URL",    "https://http--moa-rl-env--7b2fgcxb6gxp.code.run")
VLLM_URL   = os.environ.get("VLLM_URL",  "http://localhost:8001")
MODEL_NAME = os.environ.get("MODEL_NAME", "unsloth/gpt-oss-20b-instruct")
MAX_TURNS  = 8
TIMEOUT    = 120

SYSTEM_PROMPT = """\
You are a TypeScript coding agent. Fix broken source files using tools.

Emit exactly ONE tool call per response as a JSON object on its own line:
  {"tool": "read",   "params": {"path": "src/foo.ts"}}
  {"tool": "edit",   "params": {"path": "src/foo.ts", "old_string": "...", "new_string": "..."}}
  {"tool": "bash",   "params": {"cmd": "npx tsc --noEmit 2>&1 | head -10"}}
  {"tool": "submit", "params": {}}

One JSON object. No prose. No markdown fences.\
"""


@dataclass
class Turn:
    """One model generation step within an episode."""
    messages:   list[dict]   # full conversation context fed into this generation
    completion: str          # what the model generated
    logprobs:   list[float]  # per-token logprobs returned by vLLM (for reference)


@dataclass
class Trajectory:
    """A complete episode: sequence of turns + final reward."""
    turns:  list[Turn] = field(default_factory=list)
    reward: float      = 0.0


# ── env helpers ────────────────────────────────────────────────────────────────

def _env_reset() -> dict:
    r = requests.post(f"{ENV_URL}/reset", json={}, timeout=TIMEOUT)
    r.raise_for_status()
    raw = r.json()
    return raw.get("observation", raw)


def _env_step(tool: str, params: dict) -> dict:
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


# ── vLLM generation ────────────────────────────────────────────────────────────

def _vllm_generate(messages: list[dict]) -> tuple[str, list[float]]:
    """
    Call vLLM with logprobs=True.
    Returns (completion_text, per_token_logprobs).
    """
    r = requests.post(
        f"{VLLM_URL}/v1/chat/completions",
        json={
            "model": MODEL_NAME,
            "messages": messages,
            "max_tokens": 256,
            "temperature": 0.7,
            "logprobs": True,
            "top_logprobs": 1,
        },
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    result  = r.json()
    choice  = result["choices"][0]
    text    = choice["message"]["content"]
    lp_data = choice.get("logprobs", {}).get("content", [])
    logprobs = [entry["logprob"] for entry in lp_data] if lp_data else []
    return text, logprobs


# ── prompt helpers ─────────────────────────────────────────────────────────────

def _initial_messages(obs: dict) -> list[dict]:
    user_msgs = obs.get("user_messages", [])
    ctx = ""
    if user_msgs:
        ctx = "User messages that triggered this task:\n"
        ctx += "\n".join(f"  > {m}" for m in user_msgs) + "\n\n"

    content = (
        f"{ctx}"
        f"Task: {obs['task']}\n\n"
        f"File to fix: {obs['broken_file_path']}\n\n"
        "Tests that must pass:\n"
        f"```ts\n{obs.get('test_file_content', '')[:1500]}\n```\n\n"
        "Start by reading the file."
    )
    return [
        {"role": "system",  "content": SYSTEM_PROMPT},
        {"role": "user",    "content": content},
    ]


def _parse_tool_call(text: str) -> tuple[str, dict] | None:
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
            if "tool" in obj and "params" in obj:
                return obj["tool"], obj["params"]
        except json.JSONDecodeError:
            pass
    return None


# ── episode runner ─────────────────────────────────────────────────────────────

def run_episode() -> Trajectory:
    """
    Run one full interactive episode.

    At each turn the model sees all previous tool results — true reactive multi-turn.
    Captures logprobs at every generation step so GRPO loss can be computed
    across the full trajectory.

    Difference from single-completion train.py:
      Before: model generates ALL tool calls blindly upfront
      Now:    model generates ONE tool call, sees the result, then decides next move
    """
    traj     = Trajectory()
    obs      = _env_reset()
    messages = _initial_messages(obs)

    for _ in range(MAX_TURNS):
        completion, logprobs = _vllm_generate(messages)

        traj.turns.append(Turn(
            messages   = list(messages),   # snapshot of context at this step
            completion = completion,
            logprobs   = logprobs,
        ))

        parsed = _parse_tool_call(completion)
        if parsed is None:
            # Model produced no valid tool call — end with zero reward
            traj.reward = 0.0
            return traj

        tool, params = parsed

        # Append model turn to conversation
        messages.append({"role": "assistant", "content": completion})

        # Execute against env
        step_obs = _env_step(tool, params)
        done     = step_obs.get("done", False)

        if done:
            traj.reward = step_obs.get("reward", 0.0)
            return traj

        # Feed tool result back so model can react to it
        tool_result = step_obs.get("tool_result", "")
        messages.append({
            "role":    "user",
            "content": f"[{tool} result]\n{tool_result}",
        })

    # Max turns hit — force submit
    obs_final   = _env_step("submit", {})
    traj.reward = obs_final.get("reward", 0.0)
    return traj
