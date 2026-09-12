/**
 * promisePool.ts
 *
 * Pool de execução de promises com limite de concorrência estrito.
 * Evita saturação das 6 conexões por host do navegador quando múltiplas
 * requisições de roteamento viário são disparadas.
 */

export async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  iteratorFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const executing: Promise<void>[] = []
  let index = 0

  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve()
      .then(() => iteratorFn(items[i], i))
      .then((res) => {
        results[i] = res
      })
    const e: Promise<void> = p.then(() => {
      const idx = executing.indexOf(e)
      if (idx !== -1) executing.splice(idx, 1)
    })
    executing.push(e)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}
