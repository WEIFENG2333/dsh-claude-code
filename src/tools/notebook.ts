/** Claude-compatible Jupyter notebook cell editing over DSH read/write tools. */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import {
  dispatchNative,
  optionalStringArg,
  stringArg,
  type ClaudeToolBody,
} from './runtime.ts'
import type { ClaudeWorkspace } from './workspace.ts'

interface NotebookCell {
  id?: string
  cell_type: string
  source: string | string[]
  metadata: Record<string, unknown>
  execution_count?: number | null
  outputs?: unknown[]
}

interface Notebook {
  cells: NotebookCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(value: JsonValue): string {
  if (!isRecord(value) || !Array.isArray(value.lines)) throw new Error('Read did not return a text file')
  return value.lines
    .filter((line): line is Record<string, JsonValue> => isRecord(line))
    .map(line => String(line.text ?? ''))
    .join('\n')
}

function parseNotebook(content: string): Notebook {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Notebook is not valid JSON.')
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.cells)) throw new Error('Notebook is not valid JSON.')
  return parsed as unknown as Notebook
}

function cellIndex(cells: NotebookCell[], cellId: string | undefined): number {
  if (cellId === undefined) return 0
  const byId = cells.findIndex(cell => cell.id === cellId)
  if (byId >= 0) return byId
  const numbered = /^cell-(\d+)$/u.exec(cellId)
  return numbered === null ? -1 : Number(numbered[1])
}

function sourceLike(existing: string | string[] | undefined, source: string): string | string[] {
  if (!Array.isArray(existing)) return source
  const lines = source.split(/(?<=\n)/u)
  return lines.length === 1 && lines[0] === '' ? [] : lines
}

/** Create the NotebookEdit body. */
export function notebookToolBodies(ctx: Context, workspace: ClaudeWorkspace): Record<string, ClaudeToolBody> {
  return {
    NotebookEdit: async (args, exec) => {
      const requestedPath = stringArg(args, 'notebook_path')
      const notebookPath = workspace.path(exec, requestedPath)
      const newSource = stringArg(args, 'new_source')
      const requestedCellId = optionalStringArg(args, 'cell_id')
      const cellType = optionalStringArg(args, 'cell_type') ?? 'code'
      let editMode = optionalStringArg(args, 'edit_mode') ?? 'replace'

      const read = await dispatchNative(ctx, 'read', { file_path: notebookPath }, exec, 'notebook-read')
      const notebook = parseNotebook(readText(read))
      let index = cellIndex(notebook.cells, requestedCellId)
      if (editMode === 'insert' && requestedCellId !== undefined && index >= 0) index += 1
      if (editMode !== 'insert' && (index < 0 || index > notebook.cells.length)) {
        throw new Error(`Cell with ID "${requestedCellId}" not found in notebook.`)
      }
      if (editMode === 'replace' && index === notebook.cells.length) editMode = 'insert'

      let resultCellId = requestedCellId
      if (editMode === 'delete') {
        notebook.cells.splice(index, 1)
      } else if (editMode === 'insert') {
        resultCellId = randomBytes(8).toString('hex').slice(0, 13)
        const cell: NotebookCell = {
          cell_type: cellType,
          id: resultCellId,
          source: sourceLike([], newSource),
          metadata: {},
          ...(cellType === 'code' ? { execution_count: null, outputs: [] } : {}),
        }
        notebook.cells.splice(Math.max(0, index), 0, cell)
      } else {
        const cell = notebook.cells[index]
        if (cell === undefined) throw new Error(`Cell with ID "${requestedCellId}" not found in notebook.`)
        cell.source = sourceLike(cell.source, newSource)
        if (cell.cell_type === 'code') {
          cell.execution_count = null
          cell.outputs = []
        }
        if (optionalStringArg(args, 'cell_type') !== undefined) cell.cell_type = cellType
        resultCellId = cell.id ?? requestedCellId
      }

      await dispatchNative(ctx, 'write', {
        file_path: notebookPath,
        content: JSON.stringify(notebook, null, 1),
      }, exec, 'notebook-write')

      switch (editMode) {
        case 'replace':
          return `Updated cell ${resultCellId} with ${newSource}`
        case 'insert':
          return `Inserted cell ${resultCellId} with ${newSource}`
        case 'delete':
          return `Deleted cell ${resultCellId}`
        default:
          return 'Unknown edit mode'
      }
    },
  }
}
