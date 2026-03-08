import { getPlatform } from '../platform'

export interface RuntimeAgentConfig {
  systemPromptAppendix?: string
  toolAllowlist?: string[]
  scripts?: Record<string, RuntimeScript>
}

export interface RuntimeScript {
  type: 'bash'
  command: string
  description?: string
}

interface RuntimePackManifest {
  id: string
  version: string
  createdAt: number
  configChecksum: string
}

interface RuntimePackState {
  activePackId: string
  previousPackId?: string
}

export interface RuntimePackInfo {
  enabled: boolean
  runtimeRoot: string
  activePackId: string | null
  previousPackId: string | null
  availablePacks: string[]
}

const DEFAULT_PACK_ID = 'builtin-v1'

function runtimePackEnabled(): boolean {
  const type = getPlatform().type
  return type === 'electron' || type === 'capacitor'
}

function runtimeRoot(): string {
  const platform = getPlatform()
  if (platform.type === 'electron') {
    return platform.path.join(platform.process.homedir(), '.moa-runtime')
  }
  return '/moa-runtime'
}

function packsDir(): string {
  return `${runtimeRoot()}/packs`
}

function stateFile(): string {
  return `${runtimeRoot()}/state.json`
}

function normalizeAllowlist(config: RuntimeAgentConfig): string[] {
  const list = config.toolAllowlist && config.toolAllowlist.length > 0
    ? config.toolAllowlist
    : ['bash']
  return list.filter(Boolean)
}

function checksumFnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function packDir(packId: string): string {
  return `${packsDir()}/${packId}`
}

function manifestPath(packId: string): string {
  return `${packDir(packId)}/manifest.json`
}

function configPath(packId: string): string {
  return `${packDir(packId)}/agent-config.json`
}

function ensureDir(path: string): void {
  const { fs } = getPlatform()
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true })
  }
}

function readJsonSync<T>(path: string): T | null {
  const { fs } = getPlatform()
  if (!fs.existsSync(path)) return null
  try {
    const raw = fs.readFileSync(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJsonSync(path: string, value: unknown): void {
  const { fs, path: pathApi } = getPlatform()
  ensureDir(pathApi.dirname(path))
  fs.writeFileSync(path, JSON.stringify(value, null, 2))
}

function defaultAgentConfig(): RuntimeAgentConfig {
  return {
    systemPromptAppendix: [
      'Runtime Pack active.',
      'Prefer editing only approved runtime scripts/config in the runtime packs store before touching host code.',
      'Treat host app shell as immutable runtime unless explicitly requested.',
    ].join('\n'),
    toolAllowlist: ['bash'],
    scripts: {},
  }
}

function isRuntimeScript(value: unknown): value is RuntimeScript {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type !== 'bash') return false
  if (typeof record.command !== 'string' || record.command.trim().length === 0) return false
  if (record.description !== undefined && typeof record.description !== 'string') return false
  return true
}

function validateConfig(config: RuntimeAgentConfig): boolean {
  if (config.systemPromptAppendix !== undefined && typeof config.systemPromptAppendix !== 'string') return false
  if (config.toolAllowlist !== undefined) {
    if (!Array.isArray(config.toolAllowlist)) return false
    if (!config.toolAllowlist.every((item) => typeof item === 'string')) return false
  }
  if (config.scripts !== undefined) {
    if (typeof config.scripts !== 'object' || config.scripts === null) return false
    for (const script of Object.values(config.scripts)) {
      if (!isRuntimeScript(script)) return false
    }
  }
  return true
}

class RuntimePackService {
  private initialized = false

  initializeSync(): void {
    if (this.initialized) return
    if (!runtimePackEnabled()) {
      this.initialized = true
      return
    }

    ensureDir(runtimeRoot())
    ensureDir(packsDir())

    const state = readJsonSync<RuntimePackState>(stateFile())
    if (!state) {
      const initialConfig = defaultAgentConfig()
      const serializedConfig = JSON.stringify(initialConfig, null, 2)
      const checksum = checksumFnv1a(serializedConfig)
      writeJsonSync(configPath(DEFAULT_PACK_ID), initialConfig)
      writeJsonSync(manifestPath(DEFAULT_PACK_ID), {
        id: DEFAULT_PACK_ID,
        version: '1.0.0',
        createdAt: Date.now(),
        configChecksum: checksum,
      } satisfies RuntimePackManifest)
      writeJsonSync(stateFile(), { activePackId: DEFAULT_PACK_ID } satisfies RuntimePackState)
    }

    this.initialized = true
  }

  async initialize(): Promise<void> {
    this.initializeSync()
  }

  getActiveConfigSync(): RuntimeAgentConfig | null {
    if (!runtimePackEnabled()) return null
    this.initializeSync()

    const state = readJsonSync<RuntimePackState>(stateFile())
    if (!state?.activePackId) return null

    return this.loadPackConfigSync(state.activePackId)
  }

  getInfoSync(): RuntimePackInfo {
    if (!runtimePackEnabled()) {
      return {
        enabled: false,
        runtimeRoot: runtimeRoot(),
        activePackId: null,
        previousPackId: null,
        availablePacks: [],
      }
    }

    this.initializeSync()
    const state = readJsonSync<RuntimePackState>(stateFile())
    return {
      enabled: true,
      runtimeRoot: runtimeRoot(),
      activePackId: state?.activePackId ?? null,
      previousPackId: state?.previousPackId ?? null,
      availablePacks: this.listPackIdsSync(),
    }
  }

  listPackIdsSync(): string[] {
    if (!runtimePackEnabled()) return []
    this.initializeSync()
    const { fs } = getPlatform()
    if (!fs.existsSync(packsDir())) return []
    return fs.readdirSync(packsDir())
  }

  activatePackSync(packId: string): boolean {
    if (!runtimePackEnabled()) return false
    this.initializeSync()
    const state = readJsonSync<RuntimePackState>(stateFile())
    if (!state) return false

    const config = this.loadPackConfigSync(packId)
    if (!config) return false

    const nextState = {
      activePackId: packId,
      previousPackId: state.activePackId,
    } satisfies RuntimePackState

    writeJsonSync(stateFile(), nextState)

    const activationCheck = this.getActiveConfigSync()
    if (!activationCheck) {
      writeJsonSync(stateFile(), state)
      return false
    }

    return true
  }

  rollbackSync(): boolean {
    if (!runtimePackEnabled()) return false
    this.initializeSync()
    const state = readJsonSync<RuntimePackState>(stateFile())
    if (!state?.previousPackId) return false
    return this.activatePackSync(state.previousPackId)
  }

  writePackSync(packId: string, version: string, config: RuntimeAgentConfig): void {
    if (!runtimePackEnabled()) return
    this.initializeSync()
    if (!validateConfig(config)) {
      throw new Error(`Invalid runtime pack config for ${packId}`)
    }

    const serializedConfig = JSON.stringify(config, null, 2)
    const checksum = checksumFnv1a(serializedConfig)

    writeJsonSync(configPath(packId), config)
    writeJsonSync(manifestPath(packId), {
      id: packId,
      version,
      createdAt: Date.now(),
      configChecksum: checksum,
    } satisfies RuntimePackManifest)
  }

  private loadPackConfigSync(packId: string): RuntimeAgentConfig | null {
    const manifest = readJsonSync<RuntimePackManifest>(manifestPath(packId))
    const config = readJsonSync<RuntimeAgentConfig>(configPath(packId))
    if (!manifest || !config) return null

    const serializedConfig = JSON.stringify(config, null, 2)
    const checksum = checksumFnv1a(serializedConfig)
    if (checksum !== manifest.configChecksum) return null
    if (!validateConfig(config)) return null

    return config
  }

  async executeScript(scriptName: string): Promise<{ ok: boolean; output: string; packId: string | null }> {
    if (!runtimePackEnabled()) {
      return { ok: false, output: 'Runtime packs are disabled on this platform.', packId: null }
    }
    this.initializeSync()

    const state = readJsonSync<RuntimePackState>(stateFile())
    if (!state?.activePackId) {
      return { ok: false, output: 'No active runtime pack.', packId: null }
    }

    const config = this.loadPackConfigSync(state.activePackId)
    if (!config) {
      const rolledBack = this.rollbackSync()
      return {
        ok: false,
        output: rolledBack
          ? `Active runtime pack is invalid. Rolled back to previous pack.`
          : 'Active runtime pack is invalid and no rollback target is available.',
        packId: state.activePackId,
      }
    }

    const script = config.scripts?.[scriptName]
    if (!script) {
      return { ok: false, output: `Script not found: ${scriptName}`, packId: state.activePackId }
    }

    const allowlist = normalizeAllowlist(config)
    if (!allowlist.includes(script.type)) {
      return {
        ok: false,
        output: `Script type '${script.type}' is blocked by allowlist. Allowed: ${allowlist.join(', ')}`,
        packId: state.activePackId,
      }
    }

    const { process } = getPlatform()
    const result = await process.exec(script.command, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      cwd: process.cwd(),
    })

    if (result.exitCode !== 0) {
      const message = `Script '${scriptName}' failed (exit ${result.exitCode}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      return { ok: false, output: message, packId: state.activePackId }
    }

    return {
      ok: true,
      output: result.stdout || `Script '${scriptName}' completed successfully.`,
      packId: state.activePackId,
    }
  }
}

export const runtimePackService = new RuntimePackService()
