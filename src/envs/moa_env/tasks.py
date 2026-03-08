"""
Hardcoded tasks extracted from MOA traces.
Each task = one broken file + description + test that must pass.

For the hackathon: we hardcode 3 real tasks from MOA sessions.
"""

import os

MOA_REPO = os.path.expanduser("~/projs/moa/moa")

TASKS = [
    {
        "id": "task_001",
        "description": (
            "Implement a model resolver that maps model name strings to their provider "
            "and configuration. It should handle claude-opus, claude-sonnet, claude-haiku, "
            "gpt-4, and gpt-3.5 models. Return the provider name and any special config needed."
        ),
        "broken_file": "src/renderer/services/model-resolver.ts",
        "test_file": "src/renderer/services/__tests__/model-resolver.test.ts",
    },
    {
        "id": "task_002",
        "description": (
            "Implement a session store that can save and load agent sessions. "
            "Sessions should have an id, title, messages array, and createdAt timestamp. "
            "The store should support creating new sessions, updating existing ones, "
            "and listing all sessions sorted by most recent."
        ),
        "broken_file": "src/renderer/services/session-store.ts",
        "test_file": "src/renderer/services/__tests__/session-store.test.ts",
    },
    {
        "id": "task_003",
        "description": (
            "Implement the tools service that provides Read, Write, Edit, Bash, Glob, and Grep "
            "tool definitions for the agent. Each tool should have a name, description, "
            "and input schema following the Anthropic tool use format."
        ),
        "broken_file": "src/renderer/services/tools/tools.ts",
        "test_file": "src/renderer/services/tools/__tests__/tools.test.ts",
    },
]


def load_task(task_id: str = "task_001") -> dict:
    task = next(t for t in TASKS if t["id"] == task_id)

    broken_path = os.path.join(MOA_REPO, task["broken_file"])
    test_path = os.path.join(MOA_REPO, task["test_file"])

    # Read current file content as the "broken" starting point
    broken_content = ""
    if os.path.exists(broken_path):
        with open(broken_path) as f:
            broken_content = f.read()

    test_content = ""
    if os.path.exists(test_path):
        with open(test_path) as f:
            test_content = f.read()

    return {
        **task,
        "broken_file_path": broken_path,
        "broken_file_content": broken_content,
        "test_file_content": test_content,
    }
