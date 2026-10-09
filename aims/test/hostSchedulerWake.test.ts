import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
// Actual H3 wake, HMAC verification, drain, route adapter, Foundation token
// selection and HTTP IO run here. Token issuance/Console publication and the
// receiving Runtime are test boundaries, not simulated production identities.
test('signed Host wake pins generation and real enterprise identity without legacy fallback', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseAimsApprovalActions'))
      return { url: 'data:text/javascript,export const syncEnterpriseAimsApprovalActions=async()=>{}', shortCircuit: true }
    if (specifier === '@hzy/foundation/server/utils/notifications' || (specifier === './notifications' && context.parentURL?.includes('/foundation/')))
      return { url: 'data:text/javascript,' + encodeURIComponent('export const publishIntegrationOperationDeadLetter=async()=>({notificationId:"notice",recipients:["manager"]});export const publishNotification=async()=>({});export const advanceNotificationActionableLifecycle=async()=>({})'), shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/'))
      candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/'))
      candidate = resolve(root, 'aims', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:'))
      candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts'))
      return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  const calls: {
    path: string
    headers: Record<string, unknown>
    body: Record<string, unknown>
  }[] = []
  let claimNumber = 0, tokenClient = 'enterprise.runtime', tokenTenant = 'tenant-a'
  const operation = { operationId: 'op-1', operationKey: 'aims:feedback:1', tenantCode: 'tenant-a', deploymentCode: 'enterprise-a', sourceApp: 'aims', targetApp: 'altoc', operationCode: 'aims.codocs.product-document.create.v1', fencingToken: '1', command: {}, requiredCapability: 'altoc:product-feedback:update-status', commandSchemaVersion: 'product-feedback-status.v1' }
  const runtime = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req)
      raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    calls.push({ path: req.url!, headers: req.headers, body })
    let data: unknown = {}
    if (req.url?.endsWith(':pending-dead-letter-actionables'))
      data = { items: [{ tenantCode: 'tenant-a', deploymentCode: 'enterprise-a', sourceApp: 'aims', operationId: 'notice-op', generation: 1, operationVersion: 1, actionableKey: 'action', objectVersion: 'v1' }] }
    else if (req.url?.endsWith(':pending-dead-letter-closures'))
      data = { items: [{ tenantCode: 'tenant-a', deploymentCode: 'enterprise-a', sourceApp: 'aims', operationId: 'notice-op', generation: 1, actionableKey: 'action', expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved' }] }
    else if (req.url?.endsWith(':pending-failure-notifications'))
      data = { items: [] }
    else if (req.url?.endsWith(':claim-next'))
      data = null
    else if (req.url?.endsWith(':claim') && !body.operationKey)
      data = claimNumber++ === 0 ? operation : null
    else if (req.url === '/v1/enterprise/aims/notifications:scan-due')
      data = { items: [], stream: body.stream, asOf: body.asOf }
    else if (req.url === '/v1/enterprise/aims/milestones:rollover-due')
      data = { scanned: 0, rolled_over: 0, pending: 0, failed: 0 }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0, data }))
  })
  await new Promise<void>(r => runtime.listen(0, '127.0.0.1', r))
  const runtimeURL = `http://127.0.0.1:${(runtime.address() as {
    port: number
  }).port}`
  const globals = globalThis as typeof globalThis & {
    useRuntimeConfig?: () => unknown
  }
  const previousDue = process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED
  delete process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, security: { cloudflareInternalToken: 'wake-key' }, hzy: { tenantRuntime: { dataAccessMode: 'tenant-runtime', token: 'MUST-NOT-USE-STATIC' } } })
  const { setLocalServiceTokenIssuer } = await import('../../foundation/server/utils/serviceOidc.ts')
  const tokens: unknown[] = []
  const issueTestToken = async (options: { audience: string, scope: string, sourceBinding?: string }) => {
    tokens.push(options)
    assert.equal(options.sourceBinding, 'service-client-policy')
    // The unified wake also runs milestone rollover with its own exact scope.
    assert.ok(['aims:integration_operation:execute', 'aims:milestone-rollover:execute', 'aims:notifications-due:execute'].includes(String(options.scope)), String(options.scope))
    if (tokenClient === 'opaque')
      return 'opaque-fixture-token'
    return [Buffer.from('{"alg":"EdDSA"}').toString('base64url'), Buffer.from(JSON.stringify({ token_use: 'service', client_id: tokenClient, app_code: 'enterprise', tenant: tokenTenant, deployment: 'enterprise-a', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url'), 'fixture-signature'].join('.')
  }
  setLocalServiceTokenIssuer(issueTestToken)
  let server: ReturnType<typeof createServer> | undefined
  try {
    const { drainEnterpriseAims } = await import('../../enterprise/server/utils/enterpriseAimsScheduler.ts')
    const app = createApp()
    app.use('/enterprise/api/internal/aims/drain', defineEventHandler(event => drainEnterpriseAims(event)))
    server = createServer(toNodeListener(app))
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as {
      port: number
    }).port}/enterprise/api/internal/aims/drain`
    const signed = (storage = 'unified', generation = '7') => {
      const issued = String(Date.now())
      const h: Record<string, string> = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'wake-key', 'x-hzy-scheduler': 'tenant-gateway', 'x-request-id': 'wake-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'enterprise-a', 'x-hzy-app-code': 'enterprise', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': runtimeURL, 'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issued }
      if (storage)
        h['x-hzy-scheduler-storage'] = storage
      if (generation)
        h['x-hzy-scheduler-generation'] = generation
      h['x-hzy-scheduler-signature'] = createHmac('sha256', 'wake-key').update(['POST', '/enterprise/api/internal/aims/drain', 'wake-1', 'tenant-a', 'enterprise-a', 'enterprise', 'test', runtimeURL, 'tenant.test', ...(storage ? ['enterprise-scheduler-v1', storage, generation] : []), issued].join('\n')).digest('hex')
      return h
    }
    let response = await fetch(url, { method: 'POST', headers: signed() })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    assert.equal(result.claimed, 1)
    assert.equal(result.checkpointedFailures, 1)
    assert.equal(result.notificationsPublished, 1)
    // Rollover rides the same signed wake; due notifications stay behind their default-off flag.
    assert.equal(result.milestoneRollover?.scanned, 0, JSON.stringify(result.milestoneRollover))
    assert.equal(result.dueNotifications?.enabled, false, JSON.stringify(result.dueNotifications))
    const rollover = calls.filter(c => c.path === '/v1/enterprise/aims/milestones:rollover-due')
    assert.equal(rollover.length, 1)
    assert.deepEqual(rollover[0].body, {})
    assert.ok(tokens.some(t => (t as { scope?: string }).scope === 'aims:milestone-rollover:execute'))
    for (const call of calls) {
      assert.equal(call.headers['x-hzy-scheduler-generation'], '7')
      assert.equal(call.headers['x-hzy-deployment'], 'enterprise-a')
      assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    }
    const before = calls.length
    const tokensBeforeEndpointOverride = tokens.length
    response = await fetch(url, { method: 'POST', headers: { ...signed(), 'x-hzy-tenant-runtime-url': `${runtimeURL}/unsigned-target` } })
    assert.equal(response.status, 403)
    assert.equal(calls.length, before)
    assert.equal(tokens.length, tokensBeforeEndpointOverride)
    for (const headers of [{ ...signed(), 'x-hzy-scheduler-generation': '8' }, { ...signed(), 'x-hzy-scheduler-storage': '', 'x-hzy-scheduler-generation': '' }, { ...signed(), 'x-hzy-gateway-token': 'browser' }, signed('unified', ''), signed('disabled', '7')]) {
      response = await fetch(url, { method: 'POST', headers })
      assert.ok(response.status >= 400)
      assert.equal(calls.length, before)
    }
    for (const wrong of ['aims.runtime', 'opaque']) {
      tokenClient = wrong
      setLocalServiceTokenIssuer(issueTestToken)
      const tokensBeforeWrongIdentity = tokens.length
      const callsBeforeWrongIdentity = calls.length
      response = await fetch(url, { method: 'POST', headers: signed() })
      assert.equal(response.status, 403)
      assert.equal(tokens.length, tokensBeforeWrongIdentity + 1)
      assert.equal(calls.length, callsBeforeWrongIdentity)
    }
    tokenClient = 'enterprise.runtime'
    tokenTenant = 'other'
    setLocalServiceTokenIssuer(issueTestToken)
    const tokensBeforeWrongTenant = tokens.length
    const callsBeforeWrongTenant = calls.length
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 403)
    assert.equal(tokens.length, tokensBeforeWrongTenant + 1)
    assert.equal(calls.length, callsBeforeWrongTenant)
    tokenTenant = 'tenant-a'
    setLocalServiceTokenIssuer(issueTestToken)
    const tokensBeforeRestoredIdentity = tokens.length
    const callsBeforeRestoredIdentity = calls.length
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 200)
    assert.ok(tokens.length > tokensBeforeRestoredIdentity)
    assert.ok(calls.length > callsBeforeRestoredIdentity)
    process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED = 'true'
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 200)
    assert.ok(tokens.some(t => (t as { scope?: string }).scope === 'aims:notifications-due:execute'))
    assert.equal(calls.filter(call => call.path === '/v1/enterprise/aims/notifications:scan-due').length, 3)
    const legacyStart = calls.length
    response = await fetch(url, { method: 'POST', headers: signed('', '') })
    assert.equal(response.status, 503)
    assert.equal(calls.length, legacyStart)
    assert.ok(tokens.length > 0)
  } finally {
    setLocalServiceTokenIssuer(null)
    if (previousDue === undefined) delete process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED
    else process.env.HZY_AIMS_DUE_NOTIFICATIONS_ENABLED = previousDue
    globals.useRuntimeConfig = previous
    hooks.deregister()
    if (server)
      await new Promise<void>(r => server!.close(() => r()))
    await new Promise<void>(r => runtime.close(() => r()))
  }
})
