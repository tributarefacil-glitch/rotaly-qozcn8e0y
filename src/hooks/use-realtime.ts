import { useEffect, useRef } from 'react'
import type { RecordModel, RecordSubscription } from 'pocketbase'

import pb from '@/lib/pocketbase/client'

/**
 * Hook for real-time subscriptions to a PocketBase collection.
 * ALWAYS use this hook instead of subscribing inline.
 * Uses the per-listener UnsubscribeFunc so multiple components
 * can safely subscribe to the same collection without conflicts.
 *
 * Generic over the record type: pass your collection's interface as
 * `useRealtime<MyRecord>(...)` to get a typed subscription payload
 * instead of `unknown`.
 */
export interface UseRealtimeOptions {
  enabled?: boolean
  debounceMs?: number
}

export type UseRealtimeConfig = boolean | UseRealtimeOptions

export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  optionsOrEnabled: UseRealtimeConfig = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const isBoolean = typeof optionsOrEnabled === 'boolean'
  const enabled = isBoolean ? optionsOrEnabled : (optionsOrEnabled?.enabled ?? true)
  const debounceMs = isBoolean ? 0 : Math.max(0, optionsOrEnabled?.debounceMs ?? 0)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false

    const handleEvent = (e: RecordSubscription<TRecord>) => {
      if (debounceMs > 0) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null
          callbackRef.current(e)
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
