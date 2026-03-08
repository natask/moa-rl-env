"""
MOA Code Environment.

Agent is given a task description + broken TypeScript file.
Agent submits a fixed version. Tests run. Reward = test pass rate.
"""

import os
import subprocess
import tempfile
import uuid

from core.env_server import Action, Environment, Observation

from .models import MOAAction, MOAObservation, MOAState
from .tasks import load_task, TASKS


class MOAEnv(Environment):
    """
    RL environment for TypeScript code tasks derived from real MOA dev sessions.

    reset() → gives agent task description + broken file + test file
    step()  → agent submits fixed file → runs vitest → returns reward
    """

    def __init__(self):
        self._state = MOAState()
        self._task_index = 0  # cycle through tasks

    def reset(self) -> Observation:
        task_id = TASKS[self._task_index % len(TASKS)]["id"]
        self._task_index += 1

        task = load_task(task_id)
        sandbox = self._make_sandbox(task)

        self._state = MOAState(
            episode_id=str(uuid.uuid4()),
            step_count=0,
            current_task=task["description"],
            broken_file_path=task["source_file"],
            broken_file_content=task["broken_content"],
            test_file_content=task["test_file_content"],
            sandbox_dir=sandbox,
            test_file=task["test_file"],
            last_reward=0.0,
        )

        return MOAObservation(
            task=task["description"],
            broken_file_path=task["source_file"],
            broken_file_content=task["broken_content"],
            test_file_content=task["test_file_content"],
            done=False,
        )

    def _make_sandbox(self, task: dict) -> str:
        """
        Copy moav2/src to a temp dir, symlink node_modules from the pre-installed
        /app/moav2 directory (avoids copying 700MB per request), then blank the
        target source file so the agent starts from scratch.
        """
        import shutil
        MOAV2 = "/app/moav2"
        sandbox = tempfile.mkdtemp(prefix="moa_env_")

        # Copy source tree (812KB) and config files
        shutil.copytree(os.path.join(MOAV2, "src"), os.path.join(sandbox, "src"))
        for f in ("package.json", "vitest.config.ts", "tsconfig.json"):
            src = os.path.join(MOAV2, f)
            if os.path.exists(src):
                shutil.copy(src, sandbox)

        # Symlink node_modules — no copy needed
        os.symlink(
            os.path.join(MOAV2, "node_modules"),
            os.path.join(sandbox, "node_modules"),
        )

        # Blank out the target file — agent must implement it
        broken_path = os.path.join(sandbox, task["source_file"])
        with open(broken_path, "w") as f:
            f.write(task["broken_content"])

        return sandbox

    def step(self, action: Action) -> Observation:
        if not isinstance(action, MOAAction):
            raise ValueError(f"Expected MOAAction, got {type(action)}")

        self._state.step_count += 1

        # write agent's fix into sandbox
        sandbox_file = os.path.join(
            self._state.sandbox_dir,
            action.file_path.lstrip("/"),
        )
        os.makedirs(os.path.dirname(sandbox_file), exist_ok=True)
        with open(sandbox_file, "w") as f:
            f.write(action.content)

        # run tests
        passed, total, output = self._run_tests()
        reward = passed / max(total, 1)
        done = (passed == total and total > 0) or self._state.step_count >= 10

        self._state.last_reward = reward

        return MOAObservation(
            task=self._state.current_task,
            broken_file_path=self._state.broken_file_path,
            broken_file_content=action.content,  # show what agent submitted
            test_file_content=self._state.test_file_content,
            test_output=output,
            tests_passed=passed,
            tests_total=total,
            reward=reward,
            done=done,
        )

    def _run_tests(self) -> tuple[int, int, str]:
        """Run only the task's test file for speed (~500ms vs full suite)."""
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
            passed = output.count(" ✓ ")
            failed = output.count(" ✗ ") + output.count(" × ")
            total = passed + failed
            return passed, total, output[-3000:]
        except Exception as e:
            return 0, 0, str(e)

    @property
    def state(self) -> MOAState:
        return self._state
