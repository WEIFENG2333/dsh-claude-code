import { describe, expect, it } from 'vitest'
import { humanCron, nextCronRun, parseCron } from '../src/tools/cron.ts'

describe('Claude cron compatibility', () => {
  it('accepts wildcards, steps, ranges, lists, and the Sunday alias', () => {
    expect(parseCron('*/5 8-18/2 * * 1-5')).toBeDefined()
    expect(parseCron('7,22 * * * 0,7')?.dayOfWeek).toEqual([0])
    expect(parseCron('60 * * * *')).toBeUndefined()
    expect(parseCron('* * *')).toBeUndefined()
  })

  it('finds the next matching local wall-clock minute', () => {
    const next = nextCronRun('*/5 * * * *', new Date(2026, 7, 18, 12, 1, 45))
    expect(next).toEqual(new Date(2026, 7, 18, 12, 5, 0))
  })

  it('renders the common schedules Claude Code describes', () => {
    expect(humanCron('*/5 * * * *')).toBe('Every 5 minutes')
    expect(humanCron('7 * * * *')).toBe('Every hour at :07')
    expect(humanCron('57 8 * * 1-5')).toContain('Weekdays at')
  })
})
