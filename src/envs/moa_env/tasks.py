"""
Tasks for the MOA RL environment.
File contents are embedded directly so the container is self-contained.
"""

# ── Task 1: model-resolver ─────────────────────────────────────────────────────

MODEL_RESOLVER_BROKEN = """\
// TODO: implement resolveModel
import type { Model } from '@mariozechner/pi-ai'

export type AuthMethod = 'anthropic-key' | 'anthropic-oauth' | 'vertex' | string

interface ResolveModelParams {
  modelId: string
  authMethod: AuthMethod
  providerBaseUrl?: string
}

export async function resolveModel(params: ResolveModelParams): Promise<Model<any>> {
  throw new Error('not implemented')
}
"""

MODEL_RESOLVER_TEST = """\
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(),
  getProviders: vi.fn(() => []),
  getModels: vi.fn(() => []),
}))

import { resolveModel } from '../model-resolver'
import * as piAi from '@mariozechner/pi-ai'

const mockGetModel = vi.mocked(piAi.getModel)
const mockGetProviders = vi.mocked(piAi.getProviders)
const mockGetModels = vi.mocked(piAi.getModels)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProviders.mockReturnValue([])
  mockGetModels.mockReturnValue([])
})

describe('resolveModel', () => {
  it('returns a model from the Anthropic registry for anthropic-key auth', async () => {
    const registryModel = { id: 'claude-3-opus', name: 'Claude 3 Opus' }
    mockGetModel.mockReturnValue(registryModel as any)
    const result = await resolveModel({ modelId: 'claude-3-opus', authMethod: 'anthropic-key' })
    expect(result).toBe(registryModel)
    expect(mockGetModel).toHaveBeenCalledWith('anthropic', 'claude-3-opus')
  })

  it('returns a model from Vertex AI registry for vertex auth', async () => {
    const registryModel = { id: 'claude-3-opus', name: 'Claude 3 Opus' }
    mockGetModel.mockReturnValue(registryModel as any)
    const result = await resolveModel({ modelId: 'claude-3-opus', authMethod: 'vertex' })
    expect(result).toBe(registryModel)
    expect(mockGetModel).toHaveBeenCalledWith('google-vertex', 'claude-3-opus')
  })

  it('scans known providers when registry lookup fails', async () => {
    mockGetModel.mockImplementation(() => { throw new Error('not found') })
    const scanModel = { id: 'claude-3-haiku', name: 'Claude 3 Haiku' }
    mockGetProviders.mockReturnValue(['anthropic', 'openai'] as any)
    mockGetModels.mockImplementation((provider: any) => {
      if (provider === 'anthropic') return [scanModel] as any
      return []
    })
    const result = await resolveModel({ modelId: 'claude-3-haiku', authMethod: 'anthropic-key' })
    expect(result).toBe(scanModel)
  })

  it('falls back to custom config for unknown auth methods', async () => {
    mockGetModel.mockImplementation(() => { throw new Error('not found') })
    const result = await resolveModel({
      modelId: 'custom-model',
      authMethod: 'some-custom-provider-id',
      providerBaseUrl: 'http://localhost:8000',
    })
    expect(result.id).toBe('custom-model')
    expect(result.api).toBe('openai-completions')
    expect(result.baseUrl).toBe('http://localhost:8000')
  })

  it('sets reasonable defaults for custom model config', async () => {
    const result = await resolveModel({
      modelId: 'test-model',
      authMethod: 'some-provider',
      providerBaseUrl: 'http://localhost:8000',
    })
    expect(result.reasoning).toBe(false)
    expect(result.contextWindow).toBe(200000)
    expect(result.maxTokens).toBe(16384)
  })
})
"""

MODEL_RESOLVER_PACKAGE_JSON = """\
{
  "name": "moa-task-sandbox",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --reporter=verbose"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "npm:@mariozechner/pi-ai@*"
  }
}
"""

MODEL_RESOLVER_TSCONFIG = """\
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true
  }
}
"""

# ── Task 2: session-store (simplified, self-contained) ─────────────────────────

SESSION_STORE_BROKEN = """\
// TODO: implement SessionStore
export interface SessionState {
  messages: any[]
  input: string
  isStreaming: boolean
  expandedTools: Set<string>
  agentReady: boolean
}

export class SessionStore {
  getSession(sessionId: string): SessionState {
    throw new Error('not implemented')
  }
  updateSession(sessionId: string, update: Partial<SessionState>): void {
    throw new Error('not implemented')
  }
  subscribe(listener: () => void): () => void {
    throw new Error('not implemented')
  }
  setInput(sessionId: string, value: string): void {
    throw new Error('not implemented')
  }
  toggleTool(sessionId: string, toolId: string): void {
    throw new Error('not implemented')
  }
}
"""

SESSION_STORE_TEST = """\
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionStore } from '../session-store'

let store: SessionStore

beforeEach(() => {
  store = new SessionStore()
})

describe('SessionStore', () => {
  it('returns default state for unknown session', () => {
    const state = store.getSession('unknown')
    expect(state.messages).toEqual([])
    expect(state.input).toBe('')
    expect(state.isStreaming).toBe(false)
    expect(state.agentReady).toBe(false)
  })

  it('merges partial state updates', () => {
    store.updateSession('s1', { input: 'hello' })
    expect(store.getSession('s1').input).toBe('hello')
    expect(store.getSession('s1').messages).toEqual([])
  })

  it('notifies listeners on update', () => {
    const listener = vi.fn()
    store.subscribe(listener)
    store.updateSession('s1', { input: 'test' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn()
    const unsub = store.subscribe(listener)
    store.updateSession('s1', { input: 'a' })
    unsub()
    store.updateSession('s1', { input: 'b' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('setInput updates session input', () => {
    store.setInput('s1', 'hello world')
    expect(store.getSession('s1').input).toBe('hello world')
  })

  it('toggleTool adds tool to expandedTools', () => {
    store.toggleTool('s1', 'tool-1')
    expect(store.getSession('s1').expandedTools.has('tool-1')).toBe(true)
  })

  it('toggleTool removes tool on second call', () => {
    store.toggleTool('s1', 'tool-1')
    store.toggleTool('s1', 'tool-1')
    expect(store.getSession('s1').expandedTools.has('tool-1')).toBe(false)
  })
})
"""

SESSION_STORE_PACKAGE_JSON = """\
{
  "name": "moa-task-sandbox",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --reporter=verbose"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "typescript": "^5.4.0"
  }
}
"""

# ── Task registry ──────────────────────────────────────────────────────────────

TASKS = [
    {
        "id": "task_001",
        "description": (
            "Implement resolveModel() in model-resolver.ts. "
            "It maps a modelId + authMethod to a Model object. "
            "For 'anthropic-key'/'anthropic-oauth' call getModel('anthropic', modelId). "
            "For 'vertex' call getModel('google-vertex', modelId). "
            "If registry lookup fails, scan all providers. "
            "If all fail, return a custom model config with the given providerBaseUrl."
        ),
        "broken_file": "src/model-resolver.ts",
        "test_file": "src/__tests__/model-resolver.test.ts",
        "broken_content": MODEL_RESOLVER_BROKEN,
        "test_content": MODEL_RESOLVER_TEST,
        "package_json": MODEL_RESOLVER_PACKAGE_JSON,
        "tsconfig": MODEL_RESOLVER_TSCONFIG,
    },
    {
        "id": "task_002",
        "description": (
            "Implement SessionStore class in session-store.ts. "
            "It holds per-session state (messages, input, isStreaming, expandedTools, agentReady). "
            "getSession() returns a default state for unknown sessions. "
            "updateSession() merges partial updates and notifies all subscribers. "
            "subscribe() returns an unsubscribe function. "
            "setInput() and toggleTool() are convenience methods."
        ),
        "broken_file": "src/session-store.ts",
        "test_file": "src/__tests__/session-store.test.ts",
        "broken_content": SESSION_STORE_BROKEN,
        "test_content": SESSION_STORE_TEST,
        "package_json": SESSION_STORE_PACKAGE_JSON,
        "tsconfig": MODEL_RESOLVER_TSCONFIG,
    },
]


def load_task(task_id: str) -> dict:
    task = next(t for t in TASKS if t["id"] == task_id)
    return {
        **task,
        "broken_file_path": task["broken_file"],
        "broken_file_content": task["broken_content"],
        "test_file_content": task["test_content"],
    }
