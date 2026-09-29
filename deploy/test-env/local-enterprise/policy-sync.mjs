import { randomUUID } from 'node:crypto'
import { schedulerRequestHeaders } from '../../cloudflare/tenant-gateway/src/index.js'

export const POLICY_EGRESS_PATH = '/__hzy0/platform-policy'
export const POLICY_REVISION_EGRESS_PATH = '/__hzy0/platform-policy-revision'
export const POLICY_LIVE_REVISION_EGRESS_PATH = '/__hzy0/platform-policy-revision-live'
export const POLICY_URL = 'https://hzy.wiztek.cn/api/platform/internal/console/tenants/C000001/bundle?format=hzy-policy-envelope.v1&environment=test&deploymentCode=wiztek-test-console'
export const POLICY_REVISION_URL = POLICY_URL.replace('format=hzy-policy-envelope.v1', 'format=hzy-policy-revision.v1')
// Console steady service key registration (R1); fixed tenant and body shape.
export const SERVICE_KEY_EGRESS_PATH = '/__hzy0/platform-policy-service-key'
export const SERVICE_KEY_URL = 'https://hzy.wiztek.cn/api/platform/internal/console/tenants/C000001/service-keys'
export const POLICY_SYNC_INTERVAL_MS = 60000
export const POLICY_SYNC_RETRY_MS = 15000
export const POLICY_DELIVERY_MAX_BYTES = (8 << 20) + 2048
export const POLICY_PREPARED_MAX_AGE_MS = 30000
// Fallback when Console reports no renewal time: one minute below its
// 15-minute renewal interval.
export const POLICY_FULL_REFRESH_MS = 14 * 60000
const POLICY_ERROR_MAX_BYTES = 4096

function preparedUnavailable() {
  const error = Error('policy_delivery_prepared_unavailable')
  error.code = 'policy_delivery_prepared_unavailable'
  return error
}

function revisionIdentity(bytes) {
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes))?.data
    return Number.isSafeInteger(data?.policyRevision) && typeof data?.payloadHash === 'string' && typeof data?.status === 'string'
      ? `${data.policyRevision}:${data.payloadHash}:${data.status}` : null
  } catch { return null }
}

// Transport only: the destinations and format negotiation are fixed. No
// verification verdict, timestamp rewriting, or caller-selected target. Each
// wake prepares the Platform outcome (success, refusal or outage) so Console
// always runs and records its renewal state; nothing survives the wake.
// The revision probe is opt-in: a Platform without `hzy-policy-revision.v1`
// falls through to its legacy bundle branch, which may generate bundles. Only
// enable it once the target Platform serves the probe.
// hzy0 acceptance only: `fault()` may return 'unavailable' or 'refused' to
// simulate a Platform policy outage or an authenticated refusal without
// contacting Platform, so Console's outage-grace and fail-closed paths can be
// verified. 'platform-down' additionally makes the Console Runtime bootstrap
// unavailable (see console-facade.mjs): every hzy0 Platform call fails.
export const POLICY_FAULTS = new Set(['unavailable', 'refused', 'platform-down'])
const simulatedOutage = value => value === 'unavailable' || value === 'platform-down'
export function validServiceKeyRegistration(body) {
  let data
  try { data = JSON.parse(body) } catch { return false }
  return data && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data).sort().join() === 'deploymentCode,environment,publicKey'
    && data.environment === 'test' && data.deploymentCode === 'wiztek-test-console'
    && typeof data.publicKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.publicKey)
}
export function createPolicyDelivery({ platformToken, fetchImpl = fetch, now = Date.now, prepareTimeoutMs = 90000, revisionProbe = true, fault = () => null }) {
  if (!platformToken) throw Error('Platform transport credential unavailable')
  const fetchFrom = (url, signal) => fetchImpl(url, { method: 'GET', redirect: 'error',
    headers: { authorization: `Bearer ${platformToken}`, accept: 'application/json' },
    signal: signal || AbortSignal.timeout(90000) })
  let prepared = { envelope: null, revision: null }
  let preparedUntil = 0
  let pendingIdentity = null
  let lastDelivered = null
  // A newly registered service key is only in envelopes signed after it: the
  // next wake must prepare the full envelope even if the revision is unchanged.
  let keyRegistered = false
  // Bounded, fully received outcome. Platform status is kept (4xx refusals
  // must reach Console); transport failures become 503.
  const buffered = async (url, successLimit = POLICY_DELIVERY_MAX_BYTES, timeoutMs = prepareTimeoutMs) => {
    const simulated = fault()
    if (simulatedOutage(simulated)) return { status: 503, bytes: null }
    if (simulated === 'refused') return { status: 403, bytes: new TextEncoder().encode(JSON.stringify({ data: { code: 'hzy0_simulated_policy_refusal' } })) }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.min(90000, Math.max(1, timeoutMs)))
    timeout.unref?.()
    let reader
    const aborted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => {
        reject(Error('policy_delivery_unavailable'))
        queueMicrotask(() => { void reader?.cancel().catch(() => {}) })
      }, { once: true })
    })
    try {
      const response = await Promise.race([fetchFrom(url, controller.signal), aborted])
      const limit = response.ok ? successLimit : POLICY_ERROR_MAX_BYTES
      if ((response.ok && !response.headers.get('content-type')?.includes('application/json'))
        || Number(response.headers.get('content-length') || 0) > limit || !response.body) {
        void response.body?.cancel().catch(() => {})
        return { status: response.ok ? 503 : response.status, bytes: null }
      }
      reader = response.body.getReader()
      const chunks = []
      let size = 0
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted])
        if (done) break
        size += value.byteLength
        if (size > limit) return { status: response.ok ? 503 : response.status, bytes: null }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { status: response.status, bytes }
    } catch {
      return { status: 503, bytes: null }
    } finally {
      clearTimeout(timeout)
      if (reader) {
        void reader.cancel().catch(() => {})
        try { reader.releaseLock() } catch {}
      }
    }
  }
  const deliver = (kind = 'envelope') => {
    const value = prepared[kind]
    if (!value || now() > preparedUntil) {
      prepared[kind] = null
      // Console wanted an envelope this wake did not prepare (e.g. to receive a
      // newly registered service key): prepare the full one next time.
      if (kind === 'envelope') keyRegistered = true
      throw preparedUnavailable()
    }
    prepared[kind] = null
    return Promise.resolve(new Response(value.bytes, { status: value.status, headers: { 'content-type': 'application/json' } }))
  }
  // Console registers its service key through this fixed, credentialed call.
  deliver.registerServiceKey = async body => {
    if (!validServiceKeyRegistration(body)) return new Response(null, { status: 400 })
    const simulated = fault()
    if (simulatedOutage(simulated)) return new Response(null, { status: 503 })
    if (simulated === 'refused') return new Response(null, { status: 403 })
    const response = await fetchImpl(SERVICE_KEY_URL, { method: 'POST', redirect: 'error', body,
      headers: { authorization: `Bearer ${platformToken}`, accept: 'application/json', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15000) })
    if (response.ok) keyRegistered = true
    return response
  }
  // Direct fetching is a separate compatibility operation. The scheduled
  // private egress always uses prepared-only delivery and never falls back.
  deliver.direct = () => fetchFrom(POLICY_URL)
  // A service authorization read can probe the fixed revision endpoint without
  // consuming the scheduler's prepared one-shot response. It cannot fetch an
  // envelope or turn a revision hint into an authorization verdict.
  deliver.probeRevision = async () => {
    const result = await buffered(POLICY_REVISION_URL, POLICY_ERROR_MAX_BYTES, Math.min(8000, prepareTimeoutMs))
    return new Response(result.bytes, { status: result.status,
      headers: { 'content-type': 'application/json' } })
  }
  // Revision probe first; the full envelope only when the revision changed,
  // Console's stored envelope is due for renewal on this or the next wake, or
  // the probe could not decide.
  deliver.prepare = async () => {
    prepared = { envelope: null, revision: null }
    const revision = revisionProbe ? await buffered(POLICY_REVISION_URL) : { status: 503, bytes: null }
    const identity = revision.status === 200 && revision.bytes ? revisionIdentity(revision.bytes) : null
    const full = !identity || !lastDelivered || lastDelivered.identity !== identity || now() >= lastDelivered.renewAfter - POLICY_SYNC_INTERVAL_MS
    const envelope = full ? await buffered(POLICY_URL) : null
    prepared = { revision, envelope }
    pendingIdentity = identity
    preparedUntil = now() + POLICY_PREPARED_MAX_AGE_MS
    const simulated = fault()
    return { full, revisionStatus: revision.status, ...(envelope ? { envelopeStatus: envelope.status } : {}),
      ...(POLICY_FAULTS.has(simulated) ? { simulatedFault: simulated } : {}) }
  }
  deliver.clear = () => { prepared = { envelope: null, revision: null }; preparedUntil = 0 }
  // Console confirmed it holds the probed revision and reported when it must be
  // renewed. Only this confirmation lets later wakes skip the full envelope.
  deliver.confirm = renewAfter => {
    lastDelivered = pendingIdentity && !keyRegistered ? { identity: pendingIdentity,
      renewAfter: Number.isSafeInteger(renewAfter) ? renewAfter : now() + POLICY_FULL_REFRESH_MS } : null
    keyRegistered = false
  }
  // A failed wake must not count as delivered: the next wake prepares the full envelope.
  deliver.reset = () => { lastDelivered = null }
  return deliver
}

export function createPolicyWake({ facade, tenant, localSecret, preparePolicy, clearPolicy, resetPolicy, confirmPolicy, fetchImpl = fetch }) {
  const path = '/api/internal/policy-bundle/sync'
  return async () => {
    let stage = 'policy-delivery'
    let status
    const timings = {}
    let stageStartedAt = Date.now()
    try {
      if (preparePolicy) Object.assign(timings, await preparePolicy())
      timings.policyPrepareMs = Date.now() - stageStartedAt
      stage = 'bootstrap'
      stageStartedAt = Date.now()
      const identity = await facade.headers(new Request(`https://hzy0.isme.dev/console${path}`))
      timings.bootstrapMs = Date.now() - stageStartedAt
      stage = 'sign'
      const headers = await schedulerRequestHeaders({ HZY_CLOUDFLARE_INTERNAL_TOKEN: localSecret },
        tenant, 'hzy0.isme.dev', 'console', randomUUID(), String(Date.now()), identity.get('x-hzy-data-runtime-token'), path)
      // Platform unreachable for the bootstrap: Console uses its service key.
      if (identity.get('x-hzy-runtime-bootstrap-unavailable') === 'platform') headers.set('x-hzy-runtime-bootstrap-unavailable', 'platform')
      if (identity.has('x-hzy-local-runtime-dial-url')) {
        headers.set('x-hzy-local-runtime-dial-url', identity.get('x-hzy-local-runtime-dial-url'))
      }
      headers.set('x-forwarded-prefix', '/console')
      stage = 'console-fetch'
      stageStartedAt = Date.now()
      const response = await fetchImpl(`http://127.0.0.1:23100/console${path}`, {
        method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(75000)
      })
      stage = 'console-response'
      status = response.status
      const result = await response.json().catch(() => null)
      timings.consoleSyncMs = Date.now() - stageStartedAt
      if (!response.ok || result?.code !== 0 || result?.data?.ready !== true) throw Error('policy_sync_unavailable')
      confirmPolicy?.(result.data.renewAfter)
      if (typeof result.data.mode === 'string' && /^[a-z]{1,16}$/.test(result.data.mode)) timings.mode = result.data.mode
      return timings
    } catch {
      resetPolicy?.()
      // Never report the upstream error: it may include credentials or a signed envelope.
      const error = Error('policy_sync_unavailable')
      error.stage = stage
      if (Number.isInteger(status) && status >= 100 && status <= 599) error.status = status
      error.timings = timings
      throw error
    } finally {
      clearPolicy?.()
    }
  }
}

// A single, non-overlapping writer for the separate verified store. Failed
// refreshes never extend freshness. Gateway shutdown cancels future wakes.
export function startPolicySync(wake, { schedule = setTimeout, cancel = clearTimeout, report = console.log } = {}) {
  let stopped = false, timer, failures = 0
  const run = async () => {
    if (stopped) return
    const startedAt = Date.now()
    try {
      const timings = await wake()
      failures = 0
      report({ event: 'hzy0-policy-sync', ready: true, elapsedMs: Date.now() - startedAt, ...timings })
    }
    catch (error) {
      failures++
      report({ event: 'hzy0-policy-sync', ready: false,
        stage: ['policy-delivery', 'bootstrap', 'sign', 'console-fetch', 'console-response'].includes(error?.stage) ? error.stage : 'unknown',
        ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
        elapsedMs: Date.now() - startedAt, ...error?.timings })
    }
    // Slow policy delivery can consume a minute. Retry failures sooner, without
    // overlapping writes or renewing the age of any previously stored policy.
    const delay = failures ? Math.min(POLICY_SYNC_RETRY_MS * 2 ** Math.min(failures - 1, 2), 60000) : POLICY_SYNC_INTERVAL_MS
    if (!stopped) { timer = schedule(run, delay); timer?.unref?.() }
  }
  void run()
  return () => { stopped = true; if (timer) cancel(timer) }
}
