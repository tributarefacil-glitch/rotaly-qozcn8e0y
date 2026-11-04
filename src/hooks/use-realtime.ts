import { useEffect, useRef } from 'react'
import type { RecordModel, RecordSubscription } from 'pocketbase'

import pb from '@/lib/pocketbase/client'

/**
 * Opções do useRealtime. Aceita:
 *  - boolean (retrocompatível): true = assina, false = não assina
 *  - objeto: { enabled?: boolean; debounceMs?: number }
 *    debounceMs agrupa rajadas de eventos (ex.: vários updates em segundos)
 *    chamando o callback apenas uma vez por janela.
 */
export type UseRealtimeOptions = boolean | { enabled?: boolean; debounceMs?: number }

function resolveOptions(options: UseRealtimeOptions): { enabled: boolean; debounceMs: number } {
  if (typeof options === 'boolean') {
    return { enabled: options, debounceMs: 0 }
  }
  return {
    enabled: options?.enabled !== false,
    debounceMs:
      typeof options?.debounceMs === 'number' && options.debounceMs > 0 ? options.debounceMs : 0,
  }
}

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
export function useRealtime<TRecord extends RecordModel = RecordModel>(
  collectionName: string,
  callback: (data: RecordSubscription<TRecord>) => void,
  options: UseRealtimeOptions = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const { enabled, debounceMs } = resolveOptions(options)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    let unsubscribeFn: (() => Promise<void>) | undefined
    let cancelled = false

    const deliver = (data: RecordSubscription<TRecord>) => {
      if (debounceMs <= 0) {
        callbackRef.current(data)
        return
      }
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        if (!cancelled) {
          callbackRef.current(data)
        }
      }, debounceMs)
    }

    pb.collection<TRecord>(collectionName)
      .subscribe('*', (e) => {
        deliver(e)
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
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      if (unsubscribeFn) {
        unsubscribeFn().catch(() => {})
      }
    }
  }, [collectionName, enabled, debounceMs])
}

export default useRealtime
