import type { PlatformProcess } from '../../core/platform/types'

/**
 * Browser process stub.
 * Shell commands are NOT available in browser mode.
 * On Electron, the real child_process is used instead.
 */
export function createBrowserProcess(): PlatformProcess {
  return {
    exec: async (command: string) => ({
      stdout: `[Browser mode] Shell commands are not available.\nCommand attempted: ${command}\n\nTo use shell commands, run MOA in desktop mode (Electron) or connect to a remote execution server.`,
      stderr: '',
      exitCode: 1,
    }),

    execSync: (command: string) => {
      return `[Browser mode] Shell commands are not available.\nCommand attempted: ${command}\n\nTo use shell commands, run MOA in desktop mode (Electron) or connect to a remote execution server.`
    },

    cwd: () => '/',

    env: {},

    homedir: () => '/',
  }
}
