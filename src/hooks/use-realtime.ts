import { useEffect, useRef } from 'react'
import type { RecordModel, RecordSubscription } from 'pocketbase'

import pb from '@/lib/pocketbase/client'

export interface RealtimeOptions {
  enabled?: boolean
  debounceMs?: number
}

/**
 * Hook for real-time subscriptions to a PocketBase collection.
 * ALWAYS use this hook instead of subscribing inline.
 * Uses the per-listener UnsubscribeFunc so multiple components
 * can safely subscribe to the same collection without conflicts.
 *
 * Supports both:
 * - useRealtime(col, cb, enabled?: boolean)
 * - useRealtime(col, cb, options?: { enabled?: boolean, debounceMs?: number })
 */
export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  optionsOrEnabled: boolean | RealtimeOptions = true,
) {
  const isOptionsObject = typeof optionsOrEnabled === 'object' && optionsOrEnabled !== null
  const enabled = isOptionsObject ? (optionsOrEnabled.enabled ?? true) : Boolean(optionsOrEnabled)
  const debounceMs = isOptionsObject ? (optionsOrEnabled.debounceMs ?? 0) : 0

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEventRef = useRef<RecordSubscription<TRecord> | null>(null)

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false

    const handleEvent = (e: RecordSubscription<TRecord>) => {
      if (debounceMs > 0) {
        pendingEventRef.current = e
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
          if (pendingEventRef.current) {
            callbackRef.current(pendingEventRef.current)
            pendingEventRef.current = null
          }
        }, debounceMs)
      } else {
        callbackRef.current(e)
      }
    }

    pb.collection<TRecord>(collectionName)
      .subscribe('*', handleEvent)
      .then((fn) => {
        if (cancelled) {
          fn().catch(() => {})
        } else {
          unsubscribeFn = fn
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
    }
  }, [collectionName, enabled, debounceMs])
}

export default useRealtime
