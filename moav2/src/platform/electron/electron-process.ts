import type { PlatformProcess } from '../../core/platform/types'

export function createElectronProcess(): PlatformProcess {
  const childProcess = (window as any).require('child_process')
  const os = (window as any).require('os')
  const proc = (window as any).require('process')

  return {
    exec: async (command: string, opts?: { timeout?: number; maxBuffer?: number; cwd?: string }) => {
      return new Promise((resolve) => {
        childProcess.exec(command, {
          encoding: 'utf-8',
          timeout: opts?.timeout ?? 30000,
          maxBuffer: opts?.maxBuffer ?? 1024 * 1024,
          cwd: opts?.cwd,
        }, (err: any, stdout: string, stderr: string) => {
          resolve({
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: err ? (err.code ?? 1) : 0,
          })
        })
      })
    },

    execSync: (command: string, opts?: { encoding?: string; timeout?: number; maxBuffer?: number; cwd?: string }) => {
      return childProcess.execSync(command, {
        encoding: opts?.encoding ?? 'utf-8',
        timeout: opts?.timeout ?? 30000,
        maxBuffer: opts?.maxBuffer ?? 1024 * 1024,
        cwd: opts?.cwd,
      })
    },

    cwd: () => proc.cwd(),
    env: proc.env,
    homedir: () => os.homedir(),
  }
}
