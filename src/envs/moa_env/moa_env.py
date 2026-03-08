"""
MOA Code Environment — multi-turn tool-using RL environment.

Following OpenEnv RFC 005 (agentic harnesses) pattern:
  reset()              → task + broken file stub → agent starts exploring
  step(read/edit/bash) → tool result, no reward yet
  step(submit)         → runs vitest → reward = tests_passed / tests_total → done

The agent uses the same tool kit as Claude Code:
  read   — read any file in the sandbox
  edit   — apply an exact string replacement
  bash   — run a shell command in the sandbox (timeout 10s)
  submit — trigger tests and end the episode
"""

import os
import subprocess
import tempfile
import uuid

from core.env_server import Action, Environment, Observation

from .models import MOAAction, MOAObservation, MOAState
from .tasks import load_task, TASKS

MAX_STEPS = 20
BASH_TIMEOUT = 10   # seconds per bash command
READ_MAX_CHARS = 8000


class MOAEnv(Environment):
    def __init__(self):
        self._state = MOAState()
        self._task_index = 0

    # ── reset ──────────────────────────────────────────────────────

    def reset(self) -> Observation:
        task_id = TASKS[self._task_index % len(TASKS)]["id"]
        self._task_index += 1

        task = load_task(task_id)
        sandbox = self._make_sandbox(task)

        self._state = MOAState(
            episode_id=str(uuid.uuid4()),
            step_count=0,
            current_task=task["description"],
            user_messages=task.get("user_messages", []),
            broken_file_path=task["source_file"],
            broken_file_content=task["broken_content"],
            test_file_content=task["test_file_content"],
            sandbox_dir=sandbox,
            test_file=task["test_file"],
            last_reward=0.0,
        )

        return MOAObservation(
            task=task["description"],
            user_messages=task.get("user_messages", []),
            broken_file_path=task["source_file"],
            broken_file_content=task["broken_content"],
            test_file_content=task["test_file_content"],
            tool="reset",
            tool_result="",
            done=False,
            step_count=0,
        )

    # ── step ───────────────────────────────────────────────────────

    def step(self, action: Action) -> Observation:
        if not isinstance(action, MOAAction):
            raise ValueError(f"Expected MOAAction, got {type(action)}")

        self._state.step_count += 1
        tool = action.tool
        params = action.params

        # ── submit: run tests, end episode ──
        if tool == "submit":
            passed, total, output = self._run_tests()
            reward = passed / max(total, 1)
            self._state.last_reward = reward
            return MOAObservation(
                task=self._state.current_task,
                user_messages=self._state.user_messages,
                broken_file_path=self._state.broken_file_path,
                tool="submit",
                tool_result="",
                test_output=output,
                tests_passed=passed,
                tests_total=total,
                reward=reward,
                done=True,
                step_count=self._state.step_count,
            )

        # ── tool calls ──
        try:
            if tool == "read":
                result = self._tool_read(params.get("path", ""))
            elif tool == "edit":
                result = self._tool_edit(
                    params.get("path", ""),
                    params.get("old_string", ""),
                    params.get("new_string", ""),
                )
            elif tool == "bash":
                result = self._tool_bash(params.get("cmd", ""))
            else:
                result = f"Unknown tool '{tool}'. Available: read, edit, bash, submit"
        except Exception as e:
            result = f"Error: {e}"

        # max steps → auto-submit
        done = self._state.step_count >= MAX_STEPS
        if done:
            passed, total, output = self._run_tests()
            reward = passed / max(total, 1)
            self._state.last_reward = reward
        else:
            reward, passed, total, output = 0.0, 0, 0, ""

        return MOAObservation(
            task=self._state.current_task,
            user_messages=self._state.user_messages,
            broken_file_path=self._state.broken_file_path,
            tool=tool,
            tool_result=result,
            test_output=output,
            tests_passed=passed,
            tests_total=total,
            reward=reward,
            done=done,
            step_count=self._state.step_count,
        )

    # ── tools ──────────────────────────────────────────────────────

    def _sandbox_path(self, rel_path: str) -> str:
        """Resolve a relative path to the sandbox, blocking directory traversal."""
        clean = rel_path.lstrip("/")
        full = os.path.realpath(os.path.join(self._state.sandbox_dir, clean))
        if not full.startswith(os.path.realpath(self._state.sandbox_dir)):
            raise ValueError("Path escapes sandbox")
        return full

    def _tool_read(self, path: str) -> str:
        full = self._sandbox_path(path)
        if not os.path.isfile(full):
            return f"Error: file not found: {path}"
        with open(full) as f:
            content = f.read(READ_MAX_CHARS)
        if len(content) == READ_MAX_CHARS:
            content += "\n... (truncated)"
        return content

    def _tool_edit(self, path: str, old_string: str, new_string: str) -> str:
        full = self._sandbox_path(path)
        if not os.path.isfile(full):
            return f"Error: file not found: {path}"
        with open(full) as f:
            original = f.read()
        if old_string not in original:
            return f"Error: old_string not found in {path}"
        updated = original.replace(old_string, new_string, 1)
        with open(full, "w") as f:
            f.write(updated)
        lines_changed = new_string.count("\n") - old_string.count("\n")
        return f"Edited {path} ({lines_changed:+d} lines)"

    def _tool_bash(self, cmd: str) -> str:
        try:
            result = subprocess.run(
                cmd,
                shell=True,
                cwd=self._state.sandbox_dir,
                capture_output=True,
                text=True,
                timeout=BASH_TIMEOUT,
            )
            out = (result.stdout + result.stderr)[-3000:]
            return out if out else "(no output)"
        except subprocess.TimeoutExpired:
            return f"Error: command timed out after {BASH_TIMEOUT}s"
        except Exception as e:
            return f"Error: {e}"

    # ── sandbox setup ──────────────────────────────────────────────

    def _make_sandbox(self, task: dict) -> str:
        import shutil
        MOAV2 = "/app/moav2"
        sandbox = tempfile.mkdtemp(prefix="moa_env_")

        shutil.copytree(os.path.join(MOAV2, "src"), os.path.join(sandbox, "src"))
        for f in ("package.json", "vitest.config.ts", "tsconfig.json"):
            src = os.path.join(MOAV2, f)
            if os.path.exists(src):
                shutil.copy(src, sandbox)

        os.symlink(
            os.path.join(MOAV2, "node_modules"),
            os.path.join(sandbox, "node_modules"),
        )

        # Blank out the target file — agent must implement it
        broken_path = os.path.join(sandbox, task["source_file"])
        os.makedirs(os.path.dirname(broken_path), exist_ok=True)
        with open(broken_path, "w") as f:
            f.write(task["broken_content"])

        return sandbox

    # ── test runner ────────────────────────────────────────────────

    def _run_tests(self) -> tuple[int, int, str]:
        try:
            result = subprocess.run(
                ["npx", "vitest", "run", "--reporter=verbose",
                 self._state.test_file],
                cwd=self._state.sandbox_dir,
                capture_output=True,
                text=True,
                timeout=60,
            )
            output = result.stdout + result.stderr
            # Strip ANSI escape codes before counting — vitest emits them even
            # when stdout is not a TTY (captured via subprocess).
            import re as _re
            plain = _re.sub(r'\x1b\[[0-9;]*m', '', output)
            passed = plain.count(" ✓ ")
            failed = plain.count(" ✗ ") + plain.count(" × ")
            # Fallback: parse summary line "Tests  N failed (N)" / "N passed (N)"
            if passed + failed == 0:
                m = _re.search(r'Tests\s+(\d+) passed', plain)
                if m: passed = int(m.group(1))
                m = _re.search(r'Tests\s+(\d+) failed', plain)
                if m: failed = int(m.group(1))
            total = passed + failed
            return passed, total, output[-3000:]
        except Exception as e:
            return 0, 0, str(e)

    @property
    def state(self) -> MOAState:
        return self._state
