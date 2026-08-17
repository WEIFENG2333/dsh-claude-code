import { describe, expect, it } from 'vitest'
import { parseClaudeWorkflowScript } from '../src/tools/workflow.ts'

describe('Claude workflow translation', () => {
  it('extracts a pure literal meta block and leaves the executable body', () => {
    const parsed = parseClaudeWorkflowScript(`export const meta = {
      name: 'review',
      description: 'Review changes',
      phases: [{ title: 'Scan', model: 'deepseek-v4-flash' }],
    }
    phase('Scan')
    return { files: args.files }
    `)
    expect(parsed.meta).toEqual({
      name: 'review',
      description: 'Review changes',
      phases: [{ title: 'Scan', model: 'deepseek-v4-flash' }],
    })
    expect(parsed.script).toBe("phase('Scan')\n    return { files: args.files }\n    ")
  })

  it.each([
    "const meta = { name: 'x', description: 'x' }; return null",
    "export const meta = { name: getName(), description: 'x' }; return null",
    "export const meta = { name: 'x', description: `${value}` }; return null",
    "export const meta = { name: 'x', description: 'x', ...other }; return null",
  ])('rejects non-Claude or executable meta declarations', (source) => {
    expect(() => parseClaudeWorkflowScript(source)).toThrow()
  })
})
