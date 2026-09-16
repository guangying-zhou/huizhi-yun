// Coalesce concurrent refreshes only; completed results and failures are not cached.
export function createBundleRefreshFlight<T>() {
  const pending = new Map<string, Promise<T>>()
  return (key: string, refresh: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key)
    if (existing) return existing
    const result = Promise.resolve().then(refresh).finally(() => {
      if (pending.get(key) === result) pending.delete(key)
    })
    pending.set(key, result)
    return result
  }
}
