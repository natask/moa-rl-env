#!/usr/bin/env node
/**
 * MOA History CLI — Access chat history from the terminal.
 *
 * Usage:
 *   moa history list [--limit N] [--json]
 *   moa history view <session-id> [--limit N] [--role <role>] [--json]
 *   moa history search <query> [--limit N] [--session <id>] [--json]
 *
 * Options:
 *   --db <path>    Override database path (default: ~/.moa/chat-history.db)
 *   --help         Show help
 */

import { HistoryDbReader, getDefaultDbPath } from './db-reader'
import { formatSessionList, formatSessionView, formatSearchResults } from './history'

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  // Skip node and script path
  const args = argv.slice(2)
  const command = args[0] || ''
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}

  let i = 1
  while (i < args.length) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      // Check if next arg is a value (not a flag)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1]
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      positional.push(arg)
      i++
    }
  }

  return { command, positional, flags }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
MOA History CLI — Access chat history from the terminal.

Usage:
  npx tsx src/cli/index.ts list [--limit N] [--json]
  npx tsx src/cli/index.ts view <session-id> [--limit N] [--role <role>] [--json]
  npx tsx src/cli/index.ts search <query> [--limit N] [--session <id>] [--json]

Commands:
  list                    List all chat sessions
  view <session-id>       View messages in a session
  search <query>          Search across all messages

Options:
  --limit N               Limit number of results
  --role <role>           Filter messages by role (user, assistant, system)
  --session <id>          Restrict search to a specific session
  --json                  Output as JSON
  --db <path>             Override database path (default: ~/.moa/chat-history.db)
  --help                  Show this help

Environment:
  MOA_DB_PATH             Override database path
`.trim()

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv)

  if (parsed.flags.help || parsed.command === 'help' || !parsed.command) {
    console.log(HELP_TEXT)
    process.exit(parsed.command ? 0 : 2)
  }

  // Resolve database path
  const dbPath = typeof parsed.flags.db === 'string' ? parsed.flags.db : getDefaultDbPath()

  let reader: HistoryDbReader
  try {
    reader = await HistoryDbReader.create(dbPath)
  } catch (err: any) {
    console.error(`Error: Could not open database at ${dbPath}`)
    console.error(err.message)
    console.error('\nMake sure the MOA database exists. Run the Electron app first to create it,')
    console.error('or specify a different path with --db <path> or MOA_DB_PATH env variable.')
    process.exit(1)
  }

  try {
    const json = !!parsed.flags.json
    const limit = typeof parsed.flags.limit === 'string' ? parseInt(parsed.flags.limit, 10) : undefined

    switch (parsed.command) {
      case 'list': {
        const output = await formatSessionList(reader, { limit, json })
        console.log(output)
        break
      }

      case 'view': {
        const sessionId = parsed.positional[0]
        if (!sessionId) {
          console.error('Error: session ID is required for the view command.')
          console.error('Usage: moa history view <session-id>')
          process.exit(2)
        }
        const role = typeof parsed.flags.role === 'string' ? parsed.flags.role : undefined
        const output = await formatSessionView(reader, sessionId, { limit, role, json })

        if (output.startsWith('Session not found:')) {
          console.error(output)
          process.exit(3)
        }

        console.log(output)
        break
      }

      case 'search': {
        const query = parsed.positional[0]
        if (!query) {
          console.error('Error: search query is required.')
          console.error('Usage: moa history search <query>')
          process.exit(2)
        }
        const sessionId = typeof parsed.flags.session === 'string' ? parsed.flags.session : undefined
        const output = await formatSearchResults(reader, query, { limit, sessionId, json })
        console.log(output)
        break
      }

      default:
        console.error(`Unknown command: ${parsed.command}`)
        console.error('Valid commands: list, view, search')
        console.error('Run with --help for usage information.')
        process.exit(2)
    }
  } finally {
    await reader.close()
  }
}

main().catch((err: any) => {
  console.error(err?.message ?? String(err))
  process.exit(1)
})
