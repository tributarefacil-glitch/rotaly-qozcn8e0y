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
 *
 * `enabled` accepts:
 * - boolean (classic, backward compatible)
 * - { enabled, debounceMs } — options object. When debounceMs > 0, rapid
 *   successive events (e.g. telemetry bursts) are coalesced: the callback
 *   fires once per quiet window instead of once per event.
 */
export type UseRealtimeOptions = {
  enabled?: boolean
  debounceMs?: number
}

export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  options: boolean | UseRealtimeOptions = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const normalized: UseRealtimeOptions =
    typeof options === 'boolean' ? { enabled: options } : options

  const enabled = normalized.enabled ?? true
  const debounceMs = normalized.debounceMs ?? 0

  // Keep latest options in refs so they do not retrigger the subscription effect
  const debounceRef = useRef(debounceMs)
  debounceRef.current = debounceMs

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    pb.collection<TRecord>(collectionName)
      .subscribe('*', (e) => {
        if (debounceRef.current > 0) {
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            callbackRef.current(e)
          }, debounceRef.current)
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
      if (debounceTimer) clearTimeout(debounceTimer)
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
    }
  }, [collectionName, enabled])

  return
}

export default useRealtime
