"""
Models for the MOA Code Environment.

Multi-turn tool-using environment following OpenEnv RFC 005 (agentic harnesses).
The agent calls tools (read/edit/bash) across multiple steps, then submits to
trigger the test suite. Reward = tests_passed / tests_total on submit.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import List
from core.env_server import Action, Observation, State


@dataclass
class MOAAction(Action):
    """One tool call from the agent.

    tool:   "read" | "edit" | "bash" | "submit"
    params: tool-specific parameters

    read:   {"path": "src/foo.ts"}
    edit:   {"path": "src/foo.ts", "old_string": "...", "new_string": "..."}
    bash:   {"cmd": "npx tsc --noEmit 2>&1 | head -20"}
    submit: {}  — runs the test suite and ends the episode
    """
    tool: str
    params: dict = field(default_factory=dict)


@dataclass
class MOAObservation(Observation):
    """What the agent sees at each step."""
    # Present on reset and every step so agent always has context
    task: str = ""
    broken_file_path: str = ""
    user_messages: List[str] = field(default_factory=list)

    # Set on reset only (initial state)
    broken_file_content: str = ""
    test_file_content: str = ""

    # Set after each tool call
    tool: str = ""          # which tool was just called
    tool_result: str = ""   # output / result of the tool

    # Set only on submit (final step)
    test_output: str = ""
    tests_passed: int = 0
    tests_total: int = 0

    reward: float = 0.0
    done: bool = False
    step_count: int = 0


@dataclass
class MOAState(State):
    """Internal environment state."""
    episode_id: str = ""
    step_count: int = 0
    current_task: str = ""
    user_messages: List[str] = field(default_factory=list)
    broken_file_path: str = ""
    broken_file_content: str = ""
    test_file_content: str = ""
    sandbox_dir: str = ""
    test_file: str = ""
    last_reward: float = 0.0
    max_steps: int = 20
