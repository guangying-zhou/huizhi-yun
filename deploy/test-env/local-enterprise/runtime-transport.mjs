// hzy0-only dial selection. Identity and authorization remain in the signed
// Runtime bootstrap/service tokens; the loopback address is transport only.
export const PINNED_RUNTIME_DIAL = 'http://127.0.0.1:18084'
export const PINNED_RUNTIME_CANONICAL = 'https://hzy-test-runtime.isme.dev'

export function runtimeDialEndpoint(runtime) {
  if (runtime?.canonicalEndpoint !== PINNED_RUNTIME_CANONICAL || runtime?.automaticFallback !== false) {
    throw Error('Runtime transport binding rejected')
  }
  if (runtime.transportMode === 'public-https' && runtime.dialEndpoint == null) return PINNED_RUNTIME_CANONICAL
  if (runtime.transportMode === 'loopback' && runtime.dialEndpoint === PINNED_RUNTIME_DIAL) return PINNED_RUNTIME_DIAL
  throw Error('Runtime transport binding rejected')
}

const healthFields = ['runtimeProduct', 'tenant', 'deployment', 'version', 'commit', 'builtAt']

export async function verifyRuntimeTransport(profile, fetchImpl = fetch) {
  const runtime = profile?.runtime
  const dial = runtimeDialEndpoint(runtime)
  if (dial === PINNED_RUNTIME_CANONICAL) return { mode: 'public-https' }
  if (profile.environment !== 'test' || runtime.expectedTenant !== 'C000001'
    || runtime.expectedRuntimeCode !== 'c000001-test-tenant-runtime'
    || runtime.expectedRuntimeDeployment !== 'c000001-test-tenant-runtime'
    || runtime.lifecycleManagedByThisStack !== false) throw Error('Runtime identity binding rejected')

  const readHealth = async endpoint => {
    const response = await fetchImpl(`${endpoint}/runtime/healthz`, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000)
    })
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) {
      throw Error('Runtime identity probe unavailable')
    }
    const reader = response.body?.getReader()
    if (!reader) throw Error('Runtime identity probe unavailable')
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 16_384) throw Error('Runtime identity probe invalid')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
    const health = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, size)))
    if (health?.status !== 'ok' || health.runtimeProduct !== 'hzy-data-runtime'
      || health.tenant !== runtime.expectedTenant || health.deployment !== runtime.expectedRuntimeDeployment
      || healthFields.some(key => typeof health[key] !== 'string' || !health[key])) {
      throw Error('Runtime identity probe invalid')
    }
    return health
  }
  const [local, canonical] = await Promise.all([readHealth(dial), readHealth(PINNED_RUNTIME_CANONICAL)])
  if (healthFields.some(key => local[key] !== canonical[key])) throw Error('Runtime loopback identity differs from canonical')
  return { mode: 'loopback', version: local.version, commit: local.commit }
}
