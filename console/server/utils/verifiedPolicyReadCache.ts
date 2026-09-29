import type { CachedPolicyBundle } from './bundleCache'

// Cross-request reuse of a verified Console policy view. Each entry is scoped
// by the exact trust key and binding context, is reused for at most `ttlMs`,
// and is never served past its signed deadline. Failures are never cached, and
// a synchronization write replaces entries so an older in-flight read cannot
// overwrite it. Revocation therefore takes effect within `ttlMs`.
type Entry = { bundle: CachedPolicyBundle, storedAt: number, deadline: number }

const entries = new Map<string, Entry>()
const flights = new Map<string, Promise<CachedPolicyBundle | null>>()
let generation = 0

function remember(key: string, bundle: CachedPolicyBundle, storedAt: number) {
  const deadline = Date.parse(bundle.expiresAt || '')
  if (Number.isFinite(deadline)) entries.set(key, { bundle, storedAt, deadline })
  else entries.delete(key)
}

export async function readThroughVerifiedPolicy(
  key: string,
  ttlMs: number,
  load: () => Promise<CachedPolicyBundle | null>,
  now: () => number = Date.now
): Promise<CachedPolicyBundle | null> {
  if (!(ttlMs > 0)) return load()
  const startedAt = now()
  const hit = entries.get(key)
  if (hit && startedAt - hit.storedAt < ttlMs && startedAt < hit.deadline) return hit.bundle
  entries.delete(key)
  const pending = flights.get(key)
  if (pending) return pending
  const startedGeneration = generation
  const flight = load().then((bundle) => {
    if (bundle && generation === startedGeneration) remember(key, bundle, startedAt)
    return bundle
  }).finally(() => {
    if (flights.get(key) === flight) flights.delete(key)
  })
  flights.set(key, flight)
  return flight
}

export function rememberSynchronizedPolicy(key: string, bundle: CachedPolicyBundle, now: () => number = Date.now) {
  generation += 1
  entries.clear()
  flights.clear()
  remember(key, bundle, now())
}

export function resetVerifiedPolicyReadCache() {
  generation += 1
  entries.clear()
  flights.clear()
}
