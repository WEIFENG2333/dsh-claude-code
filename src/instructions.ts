/** Discover Claude Code instruction files without storing their contents in the captured baseline. */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'

type InstructionKind = 'Managed' | 'User' | 'Project' | 'Local' | 'AutoMem'

interface InstructionFile {
  readonly path: string
  readonly kind: InstructionKind
  readonly content: string
}

const MEMORY_INSTRUCTION_PROMPT = 'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'

function readInstruction(path: string, kind: InstructionKind, seen: Set<string>): InstructionFile | undefined {
  try {
    const identity = realpathSync(path)
    if (seen.has(identity)) return undefined
    const content = readFileSync(identity, 'utf8').trim()
    seen.add(identity)
    return content.length === 0 ? undefined : { path, kind, content }
  } catch {
    // Missing, inaccessible, and non-text instruction candidates are absent from the startup snapshot.
    return undefined
  }
}

function ruleFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const result: string[] = []
  const visit = (directory: string): void => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.md')) result.push(path)
    }
  }
  visit(root)
  return result
}

function append(files: InstructionFile[], seen: Set<string>, path: string, kind: InstructionKind): void {
  const file = readInstruction(path, kind, seen)
  if (file !== undefined) files.push(file)
}

function description(kind: InstructionKind): string {
  switch (kind) {
    case 'Project':
      return ' (project instructions, checked into the codebase)'
    case 'Local':
      return " (user's private project instructions, not checked in)"
    case 'AutoMem':
      return " (user's auto-memory, persists across conversations)"
    case 'Managed':
    case 'User':
      return " (user's private global instructions for all projects)"
  }
}

/** Return Claude Code's startup instruction section for one working directory. */
export function captureClaudeInstructions(
  cwd = process.cwd(),
  configDir = process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude'),
): string | undefined {
  if (/^(?:1|true|yes)$/iu.test(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS ?? '')) return undefined
  const files: InstructionFile[] = []
  const seen = new Set<string>()

  append(files, seen, '/etc/claude-code/CLAUDE.md', 'Managed')
  for (const path of ruleFiles('/etc/claude-code/rules')) append(files, seen, path, 'Managed')
  append(files, seen, join(configDir, 'CLAUDE.md'), 'User')
  for (const path of ruleFiles(join(configDir, 'rules'))) append(files, seen, path, 'User')

  const directories: string[] = []
  for (let directory = resolve(cwd); directory !== parse(directory).root; directory = dirname(directory)) {
    directories.push(directory)
  }
  for (const directory of directories.reverse()) {
    append(files, seen, join(directory, 'CLAUDE.md'), 'Project')
    append(files, seen, join(directory, '.claude', 'CLAUDE.md'), 'Project')
    for (const path of ruleFiles(join(directory, '.claude', 'rules'))) append(files, seen, path, 'Project')
    append(files, seen, join(directory, 'CLAUDE.local.md'), 'Local')
  }

  append(files, seen, join(configDir, 'memory', 'MEMORY.md'), 'AutoMem')
  if (files.length === 0) return undefined
  return [
    MEMORY_INSTRUCTION_PROMPT,
    '',
    ...files.flatMap((file, index) => [
      ...(index === 0 ? [] : ['']),
      `Contents of ${file.path}${description(file.kind)}:`,
      '',
      file.content,
    ]),
  ].join('\n')
}
