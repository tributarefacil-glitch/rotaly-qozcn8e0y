import { useState, useEffect, useCallback } from 'react'
import { AppSettingsRecord } from '@/types/delivery'
import {
  FUEL_DISCOUNT_EVENT,
  getManualFuelDiscountPct,
  setManualFuelDiscountPct,
  getReferenceMonthKey,
} from '@/services/kmAuditEngineService'

export interface UseReactiveFuelDiscountOptions {
  referenceMonthKey?: string
  settings?: AppSettingsRecord | null
  onSaveSettings?: (pct: number) => Promise<void> | void
}

/**
 * Hook reativo para leitura e alteração do desconto manual de combustível.
 * Sincroniza em tempo real através de CustomEvent (window) e persistência em app_settings / localStorage.
 * Suporta assinatura posicional ou via objeto de opções para máxima retrocompatibilidade.
 */
export function useReactiveFuelDiscount(
  arg1?: string | UseReactiveFuelDiscountOptions,
  arg2?: AppSettingsRecord | null,
  arg3?: () => void,
) {
  const isOptionsObj = typeof arg1 === 'object' && arg1 !== null
  const monthKey = isOptionsObj
    ? (arg1 as UseReactiveFuelDiscountOptions).referenceMonthKey || getReferenceMonthKey('month')
    : typeof arg1 === 'string'
      ? arg1
      : getReferenceMonthKey('month')

  const settings = isOptionsObj ? (arg1 as UseReactiveFuelDiscountOptions).settings : arg2
  const onSettingsUpdated = isOptionsObj
    ? (arg1 as UseReactiveFuelDiscountOptions).onSaveSettings
    : arg3

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
      await setManualFuelDiscountPct(monthKey, pct, settings, onSettingsUpdated as any)
    },
    [monthKey, settings, onSettingsUpdated],
  )

  return {
    discountPct,
    updateDiscount,
    manualDiscountPct: discountPct,
    setManualDiscountPct: updateDiscount,
  }
}

export { getReferenceMonthKey }
