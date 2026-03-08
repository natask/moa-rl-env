"""
Models for the MOA Code Environment.
Agent receives a task + broken file, submits a fixed file, gets scored by tests.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from core.env_server import Action, Observation, State


@dataclass
class MOAAction(Action):
    """Agent submits a fixed version of the file."""
    file_path: str      # which file they are fixing
    content: str        # the fixed file contents


@dataclass
class MOAObservation(Observation):
    """What the agent sees at each step."""
    task: str = ""                  # collapsed task description
    broken_file_path: str = ""      # path of the file to fix
    broken_file_content: str = ""   # current (broken) content
    test_file_content: str = ""     # the test file (so agent knows what must pass)
    test_output: str = ""           # vitest output after submission
    tests_passed: int = 0
    tests_total: int = 0
    reward: float = 0.0
    done: bool = False


@dataclass
class MOAState(State):
    """Internal environment state."""
    episode_id: str = ""
    step_count: int = 0
    current_task: str = ""
    broken_file_path: str = ""
    broken_file_content: str = ""
    test_file_content: str = ""
    sandbox_dir: str = ""
    last_reward: float = 0.0
