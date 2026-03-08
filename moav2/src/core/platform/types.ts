// Platform abstraction — every Node.js dependency goes through this interface.
// Browser, Electron, and Capacitor each provide their own implementation.

export interface PlatformFs {
  readFile(path: string, encoding: 'utf-8'): Promise<string>
  readFileSync(path: string, encoding: 'utf-8'): string
  writeFile(path: string, content: string): Promise<void>
  writeFileSync(path: string, content: string): void
  existsSync(path: string): boolean
  mkdirSync(path: string, opts?: { recursive: boolean }): void
  readdirSync(path: string): string[]
  statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number }
  unlinkSync(path: string): void
}

export interface PlatformPath {
  join(...parts: string[]): string
  dirname(p: string): string
  resolve(...parts: string[]): string
  basename(p: string, ext?: string): string
  extname(p: string): string
  sep: string
}

export interface PlatformProcess {
  exec(command: string, opts?: { timeout?: number; maxBuffer?: number; cwd?: string }):
    Promise<{ stdout: string; stderr: string; exitCode: number }>
  execSync(command: string, opts?: { encoding?: string; timeout?: number; maxBuffer?: number; cwd?: string }): string
  cwd(): string
  env: Record<string, string | undefined>
  homedir(): string
}

export interface PlatformDatabase {
  exec(sql: string): Promise<void>
  prepare(sql: string): PlatformStatement
  close(): Promise<void>
}

export interface PlatformStatement {
  run(...params: any[]): Promise<any>
  get(...params: any[]): Promise<any>
  all(...params: any[]): Promise<any[]>
}

export interface PlatformSqlite {
  open(name: string): Promise<PlatformDatabase>
}

export interface PlatformShell {
  openExternal(url: string): void
}

export interface Platform {
  fs: PlatformFs
  path: PlatformPath
  process: PlatformProcess
  sqlite: PlatformSqlite
  shell: PlatformShell
  type: 'browser' | 'electron' | 'capacitor'
}
