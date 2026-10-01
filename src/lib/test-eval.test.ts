import { describe, it } from 'vitest'
import pb from './pocketbase/client'
import { fuelAccountService } from '../services/fuelAccountService'
import { isCurrentMonthInTz, isBeforeCurrentMonthInTz, getYearMonthInTz } from './operationalWindow'

describe('check live data calculation', () => {
  it('calculates for the 5 couriers with real data', async () => {
    const now = new Date()
    console.log('NOW is:', now.toISOString(), 'Local year/month in SP:', getYearMonthInTz(now))
  })
})
