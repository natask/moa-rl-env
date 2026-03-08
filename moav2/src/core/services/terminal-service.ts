// Terminal service - manages shell processes for terminal buffers.
// Uses node-pty for full PTY support in Electron, with a child_process fallback.
// In browser mode, all create() calls throw an error (terminal unavailable).

import { getPlatform } from '../platform'

export interface TerminalInstance {
  id: string
  write(data: string): void
  onData(callback: (data: string) => void): void
  onExit(callback: (code: number) => void): void
  onTitleChange(callback: (title: string) => void): void
  resize(cols: number, rows: number): void
  kill(): void
}

// ---------- node-pty backend ----------

function createPtyTerminal(
  id: string,
  shellPath: string,
  cwd: string
): TerminalInstance {
  const _require = (window as any).require
  const pty = _require('node-pty')
  const proc = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: (window as any).process?.env || {},
  })

  const dataCallbacks: Array<(data: string) => void> = []
  const exitCallbacks: Array<(code: number) => void> = []
  const titleCallbacks: Array<(title: string) => void> = []

  proc.onData((data: string) => {
    for (const cb of dataCallbacks) cb(data)
  })

  proc.onExit(({ exitCode }: { exitCode: number }) => {
    for (const cb of exitCallbacks) cb(exitCode)
  })

  return {
    id,
    write(data: string) {
      proc.write(data)
    },
    onData(callback: (data: string) => void) {
      dataCallbacks.push(callback)
    },
    onExit(callback: (code: number) => void) {
      exitCallbacks.push(callback)
    },
    onTitleChange(callback: (title: string) => void) {
      titleCallbacks.push(callback)
    },
    resize(cols: number, rows: number) {
      try {
        proc.resize(cols, rows)
      } catch {
        // Resize can fail if process already exited
      }
    },
    kill() {
      try {
        proc.kill()
      } catch {
        // Already dead
      }
    },
  }
}

// ---------- child_process.spawn fallback ----------

function createSpawnTerminal(
  id: string,
  shellPath: string,
  cwd: string
): TerminalInstance {
  const _require = (window as any).require
  const cp = _require('child_process') as typeof import('child_process')
  const proc = cp.spawn(shellPath, [], {
    cwd,
    env: { ...((window as any).process?.env || {}), TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const dataCallbacks: Array<(data: string) => void> = []
  const exitCallbacks: Array<(code: number) => void> = []
  const titleCallbacks: Array<(title: string) => void> = []

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    for (const cb of dataCallbacks) cb(text)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    for (const cb of dataCallbacks) cb(text)
  })

  proc.on('exit', (code: number | null) => {
    for (const cb of exitCallbacks) cb(code ?? 1)
  })

  return {
    id,
    write(data: string) {
      try {
        proc.stdin?.write(data)
      } catch {
        // stdin may be closed
      }
    },
    onData(callback: (data: string) => void) {
      dataCallbacks.push(callback)
    },
    onExit(callback: (code: number) => void) {
      exitCallbacks.push(callback)
    },
    onTitleChange(callback: (title: string) => void) {
      titleCallbacks.push(callback)
    },
    resize(_cols: number, _rows: number) {
      // child_process.spawn does not support resize — no-op
    },
    kill() {
      try {
        proc.kill()
      } catch {
        // Already dead
      }
    },
  }
}

// ---------- Detection ----------

let _hasPty: boolean | null = null

function hasPty(): boolean {
  if (_hasPty !== null) return _hasPty
  try {
    const _require = (window as any).require
    _require('node-pty')
    _hasPty = true
  } catch {
    console.warn(
      '[terminal-service] node-pty not available, falling back to child_process.spawn (no resize, no raw PTY)'
    )
    _hasPty = false
  }
  return _hasPty
}

// ---------- Resolve default shell and cwd ----------

function defaultShell(): string {
  return getPlatform().process.env['SHELL'] || '/bin/zsh'
}

function defaultCwd(): string {
  return getPlatform().process.homedir()
}

// ---------- TerminalService ----------

export class TerminalService {
  private terminals: Map<string, TerminalInstance> = new Map()

  create(id: string, opts?: { cwd?: string; shell?: string }): TerminalInstance {
    if (getPlatform().type !== 'electron') {
      throw new Error('Terminal requires desktop mode (Electron). Shell commands are available via the agent bash tool.')
    }

    // Return existing instance if already created (HMR survival)
    const existing = this.terminals.get(id)
    if (existing) return existing

    const shellPath = opts?.shell || defaultShell()
    const cwd = opts?.cwd || defaultCwd()

    let instance: TerminalInstance
    if (hasPty()) {
      try {
        instance = createPtyTerminal(id, shellPath, cwd)
      } catch (e) {
        console.warn('[terminal-service] node-pty spawn failed, falling back to child_process:', e)
        instance = createSpawnTerminal(id, shellPath, cwd)
      }
    } else {
      instance = createSpawnTerminal(id, shellPath, cwd)
    }

    this.terminals.set(id, instance)
    return instance
  }

  get(id: string): TerminalInstance | undefined {
    return this.terminals.get(id)
  }

  destroy(id: string): void {
    const inst = this.terminals.get(id)
    if (inst) {
      inst.kill()
      this.terminals.delete(id)
    }
  }

  destroyAll(): void {
    for (const [id] of this.terminals) {
      this.destroy(id)
    }
  }
}

// HMR-safe singleton — survives Vite hot-module replacement
const _w = window as any
if (!_w.__terminalService) _w.__terminalService = new TerminalService()
export const terminalService: TerminalService = _w.__terminalService
