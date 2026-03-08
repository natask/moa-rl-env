import { getPlatform } from '../../core/platform'

type ShellResult = {
  output: string
  clear?: boolean
}

function parseArgs(command: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let tokenStarted = false

  for (const ch of command) {
    if (escaped) {
      current += ch
      escaped = false
      tokenStarted = true
      continue
    }

    if (ch === '\\' && quote !== "'") {
      escaped = true
      tokenStarted = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      tokenStarted = true
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      tokenStarted = true
      continue
    }

    if (/\s/.test(ch)) {
      if (tokenStarted) {
        args.push(current)
        current = ''
        tokenStarted = false
      }
      continue
    }

    current += ch
    tokenStarted = true
  }

  if (escaped) {
    current += '\\'
  }

  if (tokenStarted) {
    args.push(current)
  }

  return args
}

function resolvePath(
  platform: ReturnType<typeof getPlatform>,
  cwd: string,
  pathArg?: string,
): string {
  if (!pathArg || pathArg === '.') return cwd
  if (pathArg.startsWith('/')) return platform.path.resolve(pathArg)
  return platform.path.resolve(cwd, pathArg)
}

function getHelpText() {
  return [
    'Available commands:',
    '  pwd              print current directory',
    '  ls [path]        list directory contents',
    '  cd <path>        change current directory',
    '  cat <file>       print file contents',
    '  echo <text>      print text',
    '  mkdir <path>     create directory recursively',
    '  rm <file>        remove file',
    '  touch <file>     create empty file if missing',
    '  clear            clear terminal output',
    '  help             show this help',
  ].join('\n')
}

export function createCapacitorMiniShell(initialCwd = '/') {
  const platform = getPlatform()
  const startPath = platform.path.resolve(initialCwd)
  let cwd = (platform.fs.existsSync(startPath) && platform.fs.statSync(startPath).isDirectory())
    ? startPath
    : '/'

  const execute = async (command: string): Promise<ShellResult> => {
    const args = parseArgs(command)
    if (args.length === 0) return { output: '' }

    const [cmd, ...rest] = args

    try {
      switch (cmd) {
        case 'pwd':
          return { output: cwd }
        case 'ls': {
          const target = resolvePath(platform, cwd, rest[0])
          if (!platform.fs.existsSync(target)) {
            return { output: `ls: cannot access '${rest[0] || target}': No such file or directory` }
          }
          if (!platform.fs.statSync(target).isDirectory()) {
            return { output: platform.path.basename(target) }
          }
          const entries = platform.fs.readdirSync(target).map((entry) => {
            const entryPath = platform.path.resolve(target, entry)
            if (platform.fs.existsSync(entryPath) && platform.fs.statSync(entryPath).isDirectory()) {
              return `${entry}/`
            }
            return entry
          })
          return { output: entries.join('\n') }
        }
        case 'cd': {
          const nextPath = resolvePath(platform, cwd, rest[0] || '/')
          if (!platform.fs.existsSync(nextPath)) {
            return { output: `cd: no such file or directory: ${rest[0] || '/'}` }
          }
          if (!platform.fs.statSync(nextPath).isDirectory()) {
            return { output: `cd: not a directory: ${rest[0] || ''}` }
          }
          cwd = nextPath
          return { output: '' }
        }
        case 'cat': {
          if (!rest[0]) return { output: 'cat: missing file operand' }
          const file = resolvePath(platform, cwd, rest[0])
          if (!platform.fs.existsSync(file)) return { output: `cat: ${rest[0]}: No such file` }
          if (!platform.fs.statSync(file).isFile()) return { output: `cat: ${rest[0]}: Is a directory` }
          const content = platform.fs.readFileSync(file, 'utf-8')
          return { output: content }
        }
        case 'echo':
          return { output: rest.join(' ') }
        case 'mkdir': {
          if (!rest[0]) return { output: 'mkdir: missing operand' }
          const target = resolvePath(platform, cwd, rest[0])
          platform.fs.mkdirSync(target, { recursive: true })
          return { output: '' }
        }
        case 'rm': {
          if (!rest[0]) return { output: 'rm: missing operand' }
          const target = resolvePath(platform, cwd, rest[0])
          if (!platform.fs.existsSync(target)) return { output: `rm: cannot remove '${rest[0]}': No such file` }
          if (platform.fs.statSync(target).isDirectory()) {
            return { output: `rm: cannot remove '${rest[0]}': Is a directory` }
          }
          platform.fs.unlinkSync(target)
          return { output: '' }
        }
        case 'touch': {
          if (!rest[0]) return { output: 'touch: missing file operand' }
          const target = resolvePath(platform, cwd, rest[0])
          if (!platform.fs.existsSync(target)) {
            const parent = platform.path.dirname(target)
            if (!platform.fs.existsSync(parent)) {
              platform.fs.mkdirSync(parent, { recursive: true })
            }
            await platform.fs.writeFile(target, '')
          }
          return { output: '' }
        }
        case 'clear':
          return { output: '', clear: true }
        case 'help':
          return { output: getHelpText() }
        default:
          return { output: `command not found: ${cmd}\nType 'help' to see available commands.` }
      }
    } catch (e: any) {
      return { output: e?.message || String(e) }
    }
  }

  const getCwd = () => cwd

  return { execute, getCwd }
}
