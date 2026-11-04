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

export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  enabledOrOptions: boolean | UseRealtimeOptions = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const options: UseRealtimeOptions =
    typeof enabledOrOptions === 'boolean'
      ? { enabled: enabledOrOptions, debounceMs: 0 }
      : { enabled: enabledOrOptions.enabled ?? true, debounceMs: enabledOrOptions.debounceMs ?? 0 }

  const enabled = options.enabled ?? true
  const debounceMs = options.debounceMs ?? 0
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false

    pb.collection<TRecord>(collectionName)
      .subscribe('*', (e) => {
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
      })
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
