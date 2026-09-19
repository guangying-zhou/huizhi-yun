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
test('signed Aims wake pins all IO to unified generation and never falls back', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/notifications') || specifier === './notifications')
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
  let claimNumber = 0, tokenClient = 'aims.runtime', tokenTenant = 'tenant-a', selectionMismatch = false, direct = false
  const operation = { operationId: 'op-1', operationKey: 'aims:feedback:1', tenantCode: 'tenant-a', deploymentCode: 'aims-a', sourceApp: 'aims', targetApp: 'altoc', operationCode: 'aims.altoc.product-feedback.update-status.v1', fencingToken: '1', command: {}, requiredCapability: 'altoc:product-feedback:update-status', commandSchemaVersion: 'product-feedback-status.v1' }
  const runtime = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req)
      raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    calls.push({ path: req.url!, headers: req.headers, body })
    let data: unknown = {}
    if (req.url?.endsWith(':pending-dead-letter-actionables'))
      data = { items: [{ tenantCode: 'tenant-a', deploymentCode: 'aims-a', sourceApp: 'aims', operationId: 'notice-op', generation: 1, operationVersion: 1, actionableKey: 'action', objectVersion: 'v1' }] }
    else if (req.url?.endsWith(':pending-dead-letter-closures'))
      data = { items: [{ tenantCode: 'tenant-a', deploymentCode: 'aims-a', sourceApp: 'aims', operationId: 'notice-op', generation: 1, actionableKey: 'action', expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved' }] }
    else if (req.url?.endsWith(':pending-failure-notifications'))
      data = { items: [] }
    else if (req.url?.endsWith(':claim-next'))
      data = null
    else if (req.url?.endsWith(':claim') && !body.operationKey)
      data = claimNumber++ === 0 ? operation : null
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
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ public: { appCode: 'aims' }, security: { cloudflareInternalToken: 'wake-key' }, hzy: { tenantRuntime: { dataAccessMode: 'tenant-runtime', token: 'MUST-NOT-USE-STATIC' } } })
  const { setLocalServiceTokenIssuer } = await import('../../foundation/server/utils/serviceOidc.ts')
  const tokens: unknown[] = []
  setLocalServiceTokenIssuer(async (options) => {
    tokens.push(options)
    assert.equal(options.sourceBinding, 'service-client-policy')
    // The unified wake also runs milestone rollover with its own exact scope.
    assert.ok(['aims:integration_operation:execute', 'aims:milestone-rollover:execute'].includes(String(options.scope)), String(options.scope))
    if (tokenClient === 'opaque')
      return 'opaque-fixture-token'
    return [Buffer.from('{"alg":"EdDSA"}').toString('base64url'), Buffer.from(JSON.stringify({ token_use: 'service', client_id: tokenClient, app_code: 'aims', tenant: tokenTenant, deployment: 'aims-a', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url'), 'fixture-signature'].join('.')
  })
  let server: ReturnType<typeof createServer> | undefined
  try {
    const { requireTenantGatewaySchedulerRequest } = await import('../../foundation/server/utils/tenantGatewayTrust.ts')
    const { drainIntegrationOperationsForEvent } = await import('../server/utils/integrationOperationDrain.ts')
    const { createUnifiedRequestServiceTicketDeliveryOperationIO } = await import('../server/utils/serviceTicketDeliveryOperation.ts')
    const app = createApp()
    app.use('/api/internal/integration-operations/drain', defineEventHandler(async (event) => {
      const binding = await requireTenantGatewaySchedulerRequest(event, 'aims')
      if (selectionMismatch)
        binding.schedulerGeneration = ''
      if (direct) {
        const io = createUnifiedRequestServiceTicketDeliveryOperationIO(event, binding.schedulerGeneration)
        for (const path of ['/v1/aims/integration-operations/key:claim', '/v1/aims/integration-operations/key:succeed', '/v1/aims/integration-operations:pending-failure-notifications', '/v1/aims/integration-operations/op:failure-notified'])
          await io.callRuntime(path, {})
        return { ok: true }
      }
      return await drainIntegrationOperationsForEvent(event, binding, { maxClaims: 2, maxWallTimeMs: 12000, claimReserveMs: 10000 })
    }))
    server = createServer(toNodeListener(app))
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as {
      port: number
    }).port}/api/internal/integration-operations/drain`
    const signed = (storage = 'unified', generation = '7') => {
      const issued = String(Date.now())
      const h: Record<string, string> = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'wake-key', 'x-hzy-scheduler': 'tenant-gateway', 'x-request-id': 'wake-1', 'x-hzy-tenant': 'tenant-a', 'x-hzy-deployment': 'aims-a', 'x-hzy-app-code': 'aims', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': runtimeURL, 'x-forwarded-host': 'tenant.test', 'x-hzy-scheduler-issued-at': issued }
      if (storage)
        h['x-hzy-scheduler-storage'] = storage
      if (generation)
        h['x-hzy-scheduler-generation'] = generation
      h['x-hzy-scheduler-signature'] = createHmac('sha256', 'wake-key').update(['POST', '/api/internal/integration-operations/drain', 'wake-1', 'tenant-a', 'aims-a', 'aims', 'test', runtimeURL, 'tenant.test', ...(storage ? ['enterprise-scheduler-v1', storage, generation] : []), issued].join('\n')).digest('hex')
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
    direct = true
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 200)
    direct = false
    assert.equal(new Set(calls.map(c => c.path)).size, 10)
    for (const call of calls) {
      assert.match(call.path, /^\/v1\/enterprise\/aims\/(integration-operations:|milestones:rollover-due$)/)
      assert.equal(call.headers['x-hzy-scheduler-generation'], '7')
      assert.equal(call.headers['x-hzy-tenant'], 'tenant-a')
      assert.equal(call.headers['x-hzy-deployment'], 'aims-a')
      assert.notEqual(call.headers.authorization, 'Bearer MUST-NOT-USE-STATIC')
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
    selectionMismatch = true
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 403)
    selectionMismatch = false
    for (const wrong of ['enterprise.runtime', 'opaque']) {
      tokenClient = wrong
      response = await fetch(url, { method: 'POST', headers: signed() })
      assert.equal(response.status, 403)
      assert.equal(calls.length, before)
    }
    tokenClient = 'aims.runtime'
    tokenTenant = 'other'
    response = await fetch(url, { method: 'POST', headers: signed() })
    assert.equal(response.status, 403)
    assert.equal(calls.length, before)
    tokenTenant = 'tenant-a'
    const legacyStart = calls.length
    response = await fetch(url, { method: 'POST', headers: signed('', '') })
    assert.equal(response.status, 200)
    for (const call of calls.slice(legacyStart)) {
      assert.match(call.path, /^\/v1\/aims\/integration-operations/)
      assert.equal(call.headers['x-hzy-scheduler-generation'], undefined)
      assert.equal(call.headers.authorization, 'Bearer MUST-NOT-USE-STATIC')
    }
    assert.ok(calls.length > legacyStart)
    assert.ok(tokens.length > 0)
  } finally {
    setLocalServiceTokenIssuer(null)
    globals.useRuntimeConfig = previous
    hooks.deregister()
    if (server)
      await new Promise<void>(r => server!.close(() => r()))
    await new Promise<void>(r => runtime.close(() => r()))
  }
})
