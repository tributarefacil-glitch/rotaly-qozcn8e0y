import { describe, it, expect } from 'vitest'
import { isCurrentMonthInTz, isBeforeCurrentMonthInTz, getYearMonthInTz } from './operationalWindow'

describe('check live data calculation', () => {
  it('verifies operational window helpers without external live connection', () => {
    const now = new Date()
    const ym = getYearMonthInTz(now)
    expect(ym).toMatch(/^\d{4}-\d{2}$/)
    expect(isCurrentMonthInTz(now, now)).toBe(true)
    const past = new Date('2020-01-01T00:00:00Z')
    expect(isBeforeCurrentMonthInTz(past, now)).toBe(true)
  })
})
