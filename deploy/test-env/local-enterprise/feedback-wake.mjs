import { randomUUID } from 'node:crypto'
import { schedulerRequestHeaders } from '../../cloudflare/tenant-gateway/src/index.js'

// hzy0-only machine owner. The signed request selects only the feedback lane;
// it never enables the other Console or tenant scheduled tasks.
export function startFeedbackWake({ profile, tenant, secret, facade, fetchImpl = fetch, schedule = setInterval, cancel = clearInterval, report = () => {} }) {
  if (profile.features?.feedbackDeliveryEnabled !== true) return () => {}
  if (tenant.tenantCode !== 'C000001' || tenant.environment !== 'test'
    || tenant.apps?.console?.deploymentCode !== 'wiztek-test-console'
    || profile.listeners?.console?.port !== 23100) throw Error('Feedback wake binding mismatch')
  let running = false
  let phase = 'issue'
  const tick = async () => {
    if (running) return
    running = true
    try {
      const path = '/api/internal/integration-operations/drain'
      const body = JSON.stringify({ feedbackOnly: true, phase })
      phase = phase === 'issue' ? 'notification' : 'issue'
      const headers = await schedulerRequestHeaders({ HZY_TENANT_GATEWAY_INTERNAL_TOKEN: secret, HZY_CONSOLE_ORIGIN: 'http://127.0.0.1:23100' }, tenant, 'hzy0.isme.dev', 'console', randomUUID(), String(Date.now()), '', path)
      headers.set('content-type', 'application/json')
      const prepared = await facade.headers(new Request('https://hzy0.isme.dev/console' + path, { method: 'POST', headers, body }))
      for (const key of ['x-hzy-data-runtime-token', 'x-hzy-runtime-bootstrap-unavailable']) if (prepared.has(key)) headers.set(key, prepared.get(key))
      headers.set('x-hzy-local-runtime-dial-url', 'http://127.0.0.1:18084')
      const response = await fetchImpl('http://127.0.0.1:23100/console' + path, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(25000) })
      await response.body?.cancel()
      report({ task: 'feedback-wake', status: response.status })
    } catch { report({ task: 'feedback-wake', status: 'unavailable' }) }
    finally { running = false }
  }
  const timer = schedule(tick, 30000)
  timer.unref?.()
  return () => cancel(timer)
}
