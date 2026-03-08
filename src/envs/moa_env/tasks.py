"""
Tasks for the MOA RL environment.
Uses real moav2 service files. Source and tests are pre-installed in /app/moav2.
Each task blanks out one service file — the agent must re-implement it.

user_messages: real messages from MOA dev sessions. The model learns to map
terse, imprecise human intent directly to correct TypeScript implementations.
"""
import os

MOAV2_DIR = "/app/moav2"

TASKS = [
    {
        "id": "task_001",
        "user_messages": [
            "the model resolver isn't working, it keeps throwing not implemented",
            "we need it to support anthropic key, oauth, and vertex auth methods",
            "if the registry lookup fails it should scan all providers",
            "fall back to a custom config with providerBaseUrl if nothing works",
        ],
        "description": (
            "Implement resolveModel() in model-resolver.ts. "
            "It maps (modelId, authMethod) to a Model object using the pi-ai registry. "
            "For 'anthropic-key'/'anthropic-oauth': getModel('anthropic', modelId). "
            "For 'vertex': getModel('google-vertex', modelId). "
            "For 'openai-oauth': getModel('openai-codex', modelId). "
            "If registry lookup throws, scan all providers via getModels(). "
            "Fall back to a custom config using providerBaseUrl."
        ),
        "source_file": "src/core/services/model-resolver.ts",
        "test_file": "src/__tests__/model-resolver-openai-oauth.test.ts",
        "broken_content": (
            "// TODO: implement resolveModel\n"
            "export async function resolveModel(params: any): Promise<any> {\n"
            "  throw new Error('not implemented')\n"
            "}\n"
        ),
    },
    {
        "id": "task_002",
        "user_messages": [
            "add retry logic to the api client, it's failing on rate limits",
            "need exponential backoff, start at 500ms",
            "also needs to handle 429 and 5xx errors",
            "the sleep function should respect an abort signal",
        ],
        "description": (
            "Implement retry.ts with three exports: "
            "isRetryableError(e) returns true for HTTP 429/5xx and common retry keywords. "
            "sleep(ms, signal?) resolves after ms milliseconds (rejects if signal aborted). "
            "withRetry(fn, opts) calls fn() up to maxRetries times with exponential backoff."
        ),
        "source_file": "src/core/services/retry.ts",
        "test_file": "src/__tests__/retry.test.ts",
        "broken_content": (
            "// TODO: implement retry utilities\n"
            "export function isRetryableError(e: unknown): boolean {\n"
            "  throw new Error('not implemented')\n"
            "}\n"
            "export function sleep(ms: number, signal?: AbortSignal): Promise<void> {\n"
            "  throw new Error('not implemented')\n"
            "}\n"
            "export async function withRetry<T>(fn: () => Promise<T>, opts?: any): Promise<T> {\n"
            "  throw new Error('not implemented')\n"
            "}\n"
        ),
    },
    {
        "id": "task_003",
        "user_messages": [
            "we need an event store that persists to the db",
            "it needs append, query, search, count, and materialize",
            "materialize should reconstruct session state from events",
            "search should do full text search across event data",
        ],
        "description": (
            "Implement EventStore in event-store.ts. "
            "It persists events to a DB with append(event), query(filter), "
            "search(text), count(filter), and materialize(sessionId) methods."
        ),
        "source_file": "src/core/services/event-store.ts",
        "test_file": "src/__tests__/event-store.test.ts",
        "broken_content": (
            "// TODO: implement EventStore\n"
            "export class EventStore {\n"
            "  constructor(db: any) {}\n"
            "  async append(event: any): Promise<void> { throw new Error('not implemented') }\n"
            "  async query(filter: any): Promise<any[]> { throw new Error('not implemented') }\n"
            "  async search(query: string): Promise<any[]> { throw new Error('not implemented') }\n"
            "  async count(filter?: any): Promise<number> { throw new Error('not implemented') }\n"
            "  async materialize(sessionId: string): Promise<any> { throw new Error('not implemented') }\n"
            "}\n"
        ),
    },
]


def _read(path: str) -> str:
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return ""


def load_task(task_id: str) -> dict:
    task = next(t for t in TASKS if t["id"] == task_id)
    return {
        **task,
        "broken_file_path": task["source_file"],
        "broken_file_content": task["broken_content"],
        "test_file_path": task["test_file"],
        "test_file_content": _read(os.path.join(MOAV2_DIR, task["test_file"])),
        "correct_content": _read(os.path.join(MOAV2_DIR, task["source_file"])),
    }
