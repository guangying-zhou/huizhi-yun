import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { safeError, safeErrorHeaders } from './error-contract.mjs'
import { POLICY_EGRESS_PATH, POLICY_REVISION_EGRESS_PATH, POLICY_LIVE_REVISION_EGRESS_PATH, SERVICE_KEY_EGRESS_PATH } from './policy-sync.mjs'
import { hostRuntimeScopes } from './console-egress-scopes.generated.mjs'

export const CONSOLE_ORIGIN = 'https://hzy-test.huizhi.yun'
const readPaths = new Set([
  '/oauth/userinfo', '/.well-known/jwks.json', '/.well-known/openid-configuration',
  '/api/v1/console/auth/me',
  '/api/v1/console/runtime/apps/enterprise/config',
  '/api/v1/console/service/directory/users', '/api/v1/console/service/business-domains',
  '/api/v1/console/service/directory/project-access',
  '/api/v1/console/directory/users', '/api/v1/console/directory/projects', '/api/v1/console/directory/business-domains',
  '/api/v1/console/user/permissions', '/api/auth/permissions'
])
const postPaths = new Set(['/api/v1/console/user/scoped-authorization', '/api/v1/console/user/instance-conflict-explain'])

// Generated from Foundation operations reachable through registered Host
// routes. Integration adapter scopes are independent Foundation service calls.
const dataRuntimeScopes = new Set(hostRuntimeScopes)
const integrationScopes = new Set(['credential_vault:resolve', 'integration_config:view'])
// Host navigation reads policy before projecting user-facing operations.
export const internalHostRuntimeScopes = new Set(['console:policy-bundle:read'])
function allowedServiceScope(scope, audience, { notificationsInAppOnly = false, workflowLocal = false } = {}) {
  if (workflowLocal && ['data-runtime', 'tenant-runtime'].includes(audience)
    && [`${audience}:workflow:read`, `${audience}:workflow:write`].includes(scope)) return true
  if (workflowLocal && ['console:authorization:subject-eligibility', 'console:directory-users:read', 'console:authorization-role-holders:read'].includes(scope)) return audience === 'console'
  if (scope === 'workflow:proxy') return workflowLocal && audience === 'workflow'
  if (workflowLocal && scope === 'aims:integration_operation:execute') return audience === 'data-runtime'
  if (workflowLocal && scope === 'aims:work-item-completion-callback:execute') return audience === 'data-runtime'
  if (workflowLocal && scope === 'workflow:work-item-complete:create') return audience === 'workflow'
  if (workflowLocal && scope === 'data-runtime:workflow:work-item-complete:create') return audience === 'data-runtime'
  if (workflowLocal && scope === 'workflow:callback') return audience === 'aims'
  if (internalHostRuntimeScopes.has(scope)) return audience === 'data-runtime'
  if (scope === 'aims:project-products:read') return audience === 'data-runtime' && dataRuntimeScopes.has(scope)
  return typeof scope === 'string' && (
    (audience === 'console' && /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:(view|read)$/.test(scope))
    || (audience === 'data-runtime' && (dataRuntimeScopes.has(scope) || integrationScopes.has(scope)))
    || (notificationsInAppOnly && audience === 'notifications' && scope === 'notifications:publish')
  )
}

function inAppNotificationBody(body) {
  try {
    const data = JSON.parse(body)
    return data && typeof data === 'object' && !Array.isArray(data)
      && Array.isArray(data.channels) && data.channels.length === 1 && data.channels[0] === 'in_app'
  } catch { return false }
}

function allowedUserNotificationPath(method, path) {
  if (method === 'GET' && ['/api/v1/console/notifications', '/api/v1/console/notifications/summary'].includes(path)) return true
  if (method === 'POST' && path === '/api/v1/console/notifications/read-all') return true
  const item = /^\/api\/v1\/console\/notifications\/[A-Za-z0-9_-]{1,64}\/(detail|read|archive)$/.exec(path)
  return Boolean(item && ((method === 'GET' && item[1] === 'detail')
    || (method === 'POST' && ['read', 'archive'].includes(item[1]))))
}

function allowedLocalWorkflowIntrospection(body) {
  if (typeof body !== 'string' || body.length > 8192) return false
  const fields = new URLSearchParams(body)
  const entries = [...fields.entries()]
  return entries.length === 1 && entries[0][0] === 'token'
    && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/.test(entries[0][1])
}

function allowedLocalWorkflowEligibility(body) {
  let value
  try { value = JSON.parse(body) } catch { return false }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'purpose,subjectUid') return false
  return typeof value.subjectUid === 'string'
    && value.subjectUid.length > 0 && value.subjectUid.length <= 64
    && !/[\x00-\x1f\x7f]/.test(value.subjectUid)
    && value.subjectUid.toLowerCase() !== '@all'
    && !/^(?:(?:system|service)$|(?:system|service|client|svc):)/i.test(value.subjectUid)
    && ['task_approve', 'task_reject'].includes(value.purpose)
}

function localWorkflowNotificationActor(authorization) {
  // Decode only to narrow the local egress allowlist. Console verifies the
  // signature, current credential and grant before applying the lifecycle.
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(String(authorization || ''))?.[1]
  if (!token || token.length > 8192) return false
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    const hzy = claims?.hzy
    return claims?.token_use === 'service'
      && claims.sub === 'client:workflow.runtime'
      && claims.client_id === 'workflow.runtime'
      && claims.source_app === 'workflow'
      && claims.target_app === 'notifications'
      && claims.aud === 'notifications'
      && claims.scope === 'notifications:publish'
      && claims.tenant === 'C000001'
      && claims.deployment === 'C000001-test-workflow-local'
      && hzy?.appCode === 'workflow'
  } catch { return false }
}

function localWorkflowActionableBody(body) {
  let value
  try { value = JSON.parse(body) } catch { return false }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== 'actionableKey,expectedVersion,nextVersion,recipients,sourceAppCode,state'
    || value.sourceAppCode !== 'workflow' || !['resolved', 'cancelled'].includes(value.state)
    || !Array.isArray(value.recipients) || value.recipients.length < 1 || value.recipients.length > 100
    || value.recipients.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(uid))) return false
  return [value.actionableKey, value.expectedVersion, value.nextVersion].every(item => typeof item === 'string' && item.length > 0 && item.length <= 256)
    && value.expectedVersion !== value.nextVersion
}

export function allowedConsoleRequest(method, path, body, { notificationsInAppOnly = false, workflowLocal = false, authorization = '' } = {}) {
  if (allowedUserNotificationPath(method, path)) return true
  if (method === 'GET') return readPaths.has(path) || (workflowLocal && ['/api/v1/console/runtime/apps/workflow/config', '/api/v1/console/service/authorization/role-holders'].includes(path))
  if (method !== 'POST') return false
  if (path === '/oauth/introspect') return workflowLocal && allowedLocalWorkflowIntrospection(body)
  if (path === '/api/v1/console/service/authorization/subject-eligibility') {
    return workflowLocal && allowedLocalWorkflowEligibility(body)
  }
  if (path === '/api/v1/console/notifications/publish') return notificationsInAppOnly && inAppNotificationBody(body)
  if (path === '/api/v1/console/notifications/actionable-lifecycle') {
    return workflowLocal && notificationsInAppOnly
      && localWorkflowNotificationActor(authorization) && localWorkflowActionableBody(body)
  }
  if (postPaths.has(path)) return true
  if (path !== '/oauth/token') return false
  let data
  try { data = JSON.parse(body) } catch { data = Object.fromEntries(new URLSearchParams(body)) }
  if (data.client_id === 'enterprise' && ['authorization_code', 'refresh_token'].includes(data.grant_type)) {
    const fields = data.grant_type === 'authorization_code'
      ? ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier']
      : ['grant_type', 'client_id', 'refresh_token']
    return Object.keys(data).every(key => fields.includes(key))
      && (data.grant_type !== 'authorization_code' || data.redirect_uri === 'https://hzy0.isme.dev/enterprise/api/auth/oidc-callback')
  }
  const enterprise = data.client_id === 'enterprise.runtime' && data.app_code === 'enterprise'
    && ['data-runtime', 'console', ...(workflowLocal ? ['workflow'] : []), ...(notificationsInAppOnly ? ['notifications'] : [])].includes(data.audience)
  const workflow = workflowLocal && data.client_id === 'workflow.runtime' && data.app_code === 'workflow'
    && ((['data-runtime', 'tenant-runtime'].includes(data.audience)
      && [`${data.audience}:workflow:read`, `${data.audience}:workflow:write`].includes(data.scope))
      || (data.audience === 'data-runtime' && data.scope === 'data-runtime:workflow:work-item-complete:create')
      || (data.audience === 'console' && ['console:authorization:subject-eligibility', 'console:directory-users:read', 'console:authorization-role-holders:read'].includes(data.scope))
      || (data.audience === 'aims' && data.scope === 'workflow:callback')
      || (notificationsInAppOnly && data.audience === 'notifications' && data.scope === 'notifications:publish'))
  const aims = workflowLocal && data.client_id === 'aims.runtime' && data.app_code === 'aims'
    && ((data.audience === 'data-runtime' && ['aims:integration_operation:execute', 'aims:work-item-completion-callback:execute'].includes(data.scope))
      || (data.audience === 'workflow' && data.scope === 'workflow:work-item-complete:create'))
  return data.grant_type === 'client_credentials' && (enterprise || workflow || aims)
    && ['trusted-gateway', 'service-client-policy'].includes(data.source_binding)
    && allowedServiceScope(data.scope, data.audience, { notificationsInAppOnly, workflowLocal })
    && Object.keys(data).every(key => ['grant_type', 'client_id', 'app_code', 'audience', 'scope', 'source_binding'].includes(key))
}

export function createConsoleEgress({ localSecret, remoteSecret, fetchImpl = fetch, policyFetch, notificationsInAppOnly = false, workflowLocal = false }) {
  if (!localSecret || !remoteSecret || localSecret === remoteSecret) throw Error('Distinct egress credentials required')
  return createServer(async (req, res) => {
    const correlationId = randomUUID()
    const suppliedRequestId = String(req.headers['x-request-id'] || '')
    const requestId = /^[A-Za-z0-9_-]{1,64}$/.test(suppliedRequestId) ? suppliedRequestId : ''
    const reply = (status, code = 'hzy0_console_egress_failed') => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-request-id': correlationId })
      res.end(JSON.stringify({ statusCode: status, message: 'Console egress request failed', code, correlationId }))
    }
    const provided = Buffer.from(String(req.headers['x-hzy0-egress-token'] || ''))
    const expected = Buffer.from(localSecret)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply(401)
    try {
      if (req.url === SERVICE_KEY_EGRESS_PATH) {
        if (!policyFetch?.registerServiceKey || req.method !== 'POST' || req.headers['transfer-encoding']) return reply(403)
        let body = ''
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return reply(413) }
        let response
        try { response = await policyFetch.registerServiceKey(body) } catch { return reply(503) }
        const text = (await response.text()).slice(0, 4096)
        console.log(JSON.stringify({ event: 'hzy0-service-key-registration', status: response.status }))
        // Platform's status is kept so Console can tell an outage from a refusal.
        res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(text || JSON.stringify({ statusCode: response.status })); return
      }
      if (req.url?.startsWith(POLICY_EGRESS_PATH)) {
        const kind = req.url === POLICY_EGRESS_PATH ? 'envelope' : req.url === POLICY_REVISION_EGRESS_PATH ? 'revision' : null
        const liveRevision = req.url === POLICY_LIVE_REVISION_EGRESS_PATH
        if (!policyFetch || (!kind && !liveRevision) || (liveRevision && (!workflowLocal || !policyFetch.probeRevision)) || req.method !== 'GET'
          || req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0) return reply(403)
        const startedAt = Date.now()
        let response
        try { response = liveRevision ? await policyFetch.probeRevision() : await policyFetch(kind) } catch (error) {
          const expired = error?.code === 'policy_delivery_prepared_unavailable'
          console.error(JSON.stringify({ event: 'hzy0-policy-delivery', stage: expired ? 'prepared-expired' : 'fetch', status: expired ? 503 : 502, elapsedMs: Date.now() - startedAt }))
          return reply(expired ? 503 : 502, expired ? 'policy_delivery_prepared_unavailable' : 'hzy0_console_egress_failed')
        }
        // Authenticated Platform refusals keep their status and stable code so
        // Console records `refused`; outages, 408 and 429 stay 503.
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          let code = 'hzy0_platform_policy_refused'
          try {
            const text = (await response.text()).slice(0, 4096)
            const candidate = JSON.parse(text)?.data?.code
            if (typeof candidate === 'string' && /^[a-z][a-z0-9_]{0,80}$/.test(candidate)) code = candidate
          } catch {}
          console.error(JSON.stringify({ event: 'hzy0-policy-delivery', stage: `${liveRevision ? 'live-revision' : kind}-refused`, status: response.status, elapsedMs: Date.now() - startedAt }))
          return reply(response.status, code)
        }
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel(); return reply(503)
        }
        const chunks = []; let bytes = 0
        if (response.body) for await (const chunk of response.body) {
          bytes += chunk.length
          if (bytes > (8 << 20) + 2048) return reply(502)
          chunks.push(Buffer.from(chunk))
        }
        console.log(JSON.stringify({ event: 'hzy0-policy-delivery', stage: `${liveRevision ? 'live-revision' : kind}-complete`, status: response.status, bytes, elapsedMs: Date.now() - startedAt }))
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(Buffer.concat(chunks)); return
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || /%|\\/.test(req.url.split('?')[0])) return reply(403)
      const url = new URL(req.url, CONSOLE_ORIGIN)
      if (url.origin !== CONSOLE_ORIGIN || url.hash) return reply(403)
      let body = ''
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) return reply(413) }
      if (!allowedConsoleRequest(req.method, url.pathname, body, { notificationsInAppOnly, workflowLocal, authorization: req.headers.authorization })) {
        const decision = tokenRequestDecision(url.pathname, body)
        console.error(JSON.stringify({ event: 'hzy0-console-egress', correlationId, ...(requestId ? { requestId } : {}), path: url.pathname, status: 403, stage: 'allowlist', ...decision }))
        return reply(403, 'hzy0_console_egress_denied')
      }
      const headers = new Headers({ accept: 'application/json', 'content-type': req.headers['content-type'] === 'application/x-www-form-urlencoded' ? 'application/x-www-form-urlencoded' : 'application/json' })
      // Only user/session authorization passes through; all caller-supplied
      // routing, Gateway, Cloudflare and forwarding headers are discarded.
      for (const name of ['authorization', 'cookie']) if (req.headers[name]) headers.set(name, req.headers[name])
      if (requestId) headers.set('x-request-id', requestId)
      for (const [name, value] of Object.entries({
        'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': remoteSecret,
        'x-hzy-app-code': 'enterprise', 'x-hzy-tenant': 'C000001',
        'x-hzy-environment': 'test', 'x-hzy-deployment': 'C000001-test-enterprise'
      })) headers.set(name, value)
      const controller = new AbortController()
      res.once('close', () => controller.abort())
      const response = await fetchImpl(url, { method: req.method, headers, redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        ...(req.method === 'POST' ? { body } : {}) })
      console.log(JSON.stringify({ event: 'hzy0-console-egress', correlationId, ...(requestId ? { requestId } : {}), path: url.pathname, status: response.status, stage: 'upstream' }))
      if (!response.ok) {
        let scope
        if (url.pathname === '/oauth/token') { try { const candidate = JSON.parse(body); if (allowedServiceScope(candidate.scope, candidate.audience, { notificationsInAppOnly, workflowLocal })) scope = candidate.scope } catch {} }
        console.error(JSON.stringify({ event: 'hzy0-console-egress', correlationId, ...(requestId ? { requestId } : {}), path: url.pathname, status: response.status, stage: 'console-service-authorization', scope }))
        let body = '', tooLarge = false
        if (response.body) for await (const chunk of response.body) {
          if (Buffer.byteLength(body) + chunk.length > 65536) { tooLarge = true; break }
          body += Buffer.from(chunk).toString()
        }
        res.writeHead(response.status, safeErrorHeaders(response.status, Object.fromEntries(response.headers)))
        res.end(JSON.stringify(safeError(response.status, response.headers.get('content-type'), tooLarge ? '' : body)))
        return
      }
      if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); return reply(502) }
      const payload = await response.text()
      res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(payload)
    } catch { if (!res.headersSent) reply(502); else res.destroy() }
  })
}

function tokenRequestDecision(path, body) {
  if (path !== '/oauth/token') return {}
  try {
    const value = JSON.parse(body)
    const scope = typeof value.scope === 'string' && (dataRuntimeScopes.has(value.scope) || integrationScopes.has(value.scope) || /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){1,2}$/.test(value.scope)) ? value.scope : undefined
    const audience = ['data-runtime', 'console'].includes(value.audience) ? value.audience : undefined
    return { ...(scope ? { scope } : {}), ...(audience ? { audience } : {}) }
  } catch { return {} }
}
