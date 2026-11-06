import { useState, useEffect, useCallback } from 'react'
import { AppSettingsRecord } from '@/types/delivery'
import {
  FUEL_DISCOUNT_EVENT,
  getManualFuelDiscountPct,
  setManualFuelDiscountPct,
  getReferenceMonthKey,
} from '@/services/kmAuditEngineService'

/**
 * Hook reativo para leitura e alteração do desconto manual de combustível.
 * Sincroniza em tempo real através de CustomEvent (window) e persistência em app_settings / localStorage.
 */
export function useReactiveFuelDiscount(
  monthKey: string,
  settings?: AppSettingsRecord | null,
  onSettingsUpdated?: () => void,
) {
  const [discountPct, setDiscountPct] = useState<number>(() =>
    getManualFuelDiscountPct(monthKey, settings),
  )

  useEffect(() => {
    setDiscountPct(getManualFuelDiscountPct(monthKey, settings))
  }, [monthKey, settings])

  useEffect(() => {
    const handleDiscountChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ monthKey: string; pct: number }>
      if (customEvent.detail && customEvent.detail.monthKey === monthKey) {
        setDiscountPct(customEvent.detail.pct)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(FUEL_DISCOUNT_EVENT, handleDiscountChanged)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(FUEL_DISCOUNT_EVENT, handleDiscountChanged)
      }
    }
  }, [monthKey])

  const updateDiscount = useCallback(
    async (pct: number) => {
      setDiscountPct(pct)
      await setManualFuelDiscountPct(monthKey, pct, settings, onSettingsUpdated)
    },
    [monthKey, settings, onSettingsUpdated],
  )

  return {
    discountPct,
    updateDiscount,
  }
}

export { getReferenceMonthKey }
