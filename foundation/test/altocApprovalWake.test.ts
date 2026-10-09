import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { callEnterpriseAltocApprovalWorker, callEnterpriseFinanceApprovalWorker, callEnterprisePeopleApprovalWorker, callEnterpriseAPFDueWorker, callEnterpriseAPFDeadLetterWorker } from '../server/utils/enterpriseRuntimeChannels'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc'

// Only disposable HTTP fixtures. No configured Runtime/Console or credentials.
test('Altoc recovery wake carries its exact Enterprise identity, generation and no actor; wrong/opaque tokens never reach Runtime', async () => {
  const previousFlag = process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED
  process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED = 'true'
  const calls: { path: string, headers: Record<string, unknown> }[] = []
  const runtime = createServer((req, res) => {
    calls.push({ path: req.url!, headers: req.headers })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: req.url?.endsWith(':pending') ? [] : { bound: true } }))
  })
  await new Promise<void>(resolve => runtime.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(runtime.address() as { port: number }).port}`
  const globals = globalThis as { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  globals.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, security: { cloudflareInternalToken: 'fixture-wake' }, hzy: { tenantRuntime: { dataAccessMode: 'tenant-runtime' } } })
  let client = 'enterprise.runtime', issued = 0
  let domain: 'altoc' | 'finance' | 'people' = 'altoc'
  let cloudflareFlag: string | undefined
  let dueMode = false
  let deadMode = false
  const issue = async (options: { scope: string, sourceBinding?: string }) => {
    issued++
    assert.equal(options.scope, `${domain}:scheduler:execute`)
    assert.equal(options.sourceBinding, 'service-client-policy')
    if (client === 'opaque') return 'opaque-fixture'
    return [Buffer.from('{"alg":"EdDSA"}').toString('base64url'), Buffer.from(JSON.stringify({ token_use: 'service', client_id: client, app_code: 'enterprise', tenant: 'fixture-tenant', deployment: 'host-fixture', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url'), 'fixture-signature'].join('.')
  }
  setLocalServiceTokenIssuer(issue)
  const path = '/enterprise/api/internal/apf/scheduler-inspect'
  const app = createApp()
  app.use(path, defineEventHandler(async (event) => {
    if (cloudflareFlag !== undefined) event.context.cloudflare = { env: { HZY_ENTERPRISE_APF_SCHEDULER_ENABLED: cloudflareFlag } }
    if (deadMode) {
      for (const operation of ['pending-dead-letter-actionables', 'dead-letter-actionable-published', 'pending-dead-letter-closures', 'dead-letter-closure-acknowledged'] as const) await callEnterpriseAPFDeadLetterWorker(event, domain, operation, {})
      return { code: 0 }
    }
    if (dueMode) {
      const families = domain === 'altoc' ? ['sales-due', 'billing-due'] as const : domain === 'finance' ? ['issuance-due', 'reconciliation-due'] as const : ['handover-due', 'asset-recovery-due'] as const
      for (const family of families) for (const action of ['scan-due', 'published', 'closure-ack'] as const) await callEnterpriseAPFDueWorker(event, family, action, {})
      return { code: 0 }
    }
    const worker = domain === 'altoc' ? callEnterpriseAltocApprovalWorker : domain === 'finance' ? callEnterpriseFinanceApprovalWorker : callEnterprisePeopleApprovalWorker
    return { pending: await worker(event, 'pending', {}), bound: await worker(event, 'bind', domain === 'people' ? { operationKey: 'fixture', workflowInstanceId: '1' } : { requestNo: 'APF-fixture' }) }
  }))
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`
  const headers = () => {
    const at = String(Date.now())
    return { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'fixture-wake', 'x-hzy-scheduler': 'tenant-gateway', 'x-request-id': 'fixture-wake-id', 'x-hzy-tenant': 'fixture-tenant', 'x-hzy-deployment': 'host-fixture', 'x-hzy-app-code': 'enterprise', 'x-hzy-environment': 'test', 'x-hzy-data-runtime-url': endpoint, 'x-forwarded-host': 'fixture.test', 'x-hzy-scheduler-issued-at': at, 'x-hzy-apf-domain': domain, 'x-hzy-scheduler-storage': 'unified', 'x-hzy-scheduler-generation': '7', 'x-hzy-scheduler-signature': createHmac('sha256', 'fixture-wake').update(['POST', path, 'fixture-wake-id', 'fixture-tenant', 'host-fixture', 'enterprise', 'test', endpoint, 'fixture.test', 'enterprise-scheduler-v1', 'unified', '7', 'enterprise-apf-v1', domain, at].join('\n')).digest('hex') }
  }
  try {
    assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
    assert.deepEqual(calls.map(call => call.path), ['/v1/enterprise/altoc/approval:pending', '/v1/enterprise/altoc/approval:bind'])
    for (const call of calls) {
      assert.equal(call.headers['x-hzy-scheduler-generation'], '7')
      assert.equal(call.headers['x-hzy-actor-uid'], undefined)
      assert.equal(call.headers['x-hzy-actor-purpose'], undefined)
    }
    for (const wrong of ['aims.runtime', 'opaque']) {
      client = wrong
      setLocalServiceTokenIssuer(issue)
      const tokens = issued, before = calls.length
      assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 403)
      assert.equal(issued, tokens + 1)
      assert.equal(calls.length, before)
    }
    client = 'enterprise.runtime'
    setLocalServiceTokenIssuer(issue)
    assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
    for (const next of ['finance', 'people'] as const) {
      domain = next
      const before = calls.length
      assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
      const prefix = next === 'finance' ? '/v1/enterprise/finance/invoice-approval' : '/v1/enterprise/people/assignment-approval'
      assert.deepEqual(calls.slice(before).map(call => call.path), [`${prefix}:pending`, `${prefix}:${next === 'finance' ? 'bind-system' : 'bind'}`])
    }
    dueMode = true
    for (const next of ['altoc', 'finance', 'people'] as const) {
      domain = next
      const before = calls.length
      assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
      const families = next === 'altoc' ? ['sales-due', 'billing-due'] : next === 'finance' ? ['issuance-due', 'reconciliation-due'] : ['handover-due', 'asset-recovery-due']
      assert.deepEqual(calls.slice(before).map(call => call.path), families.flatMap(family => ['scan-due', 'published', 'closure-ack'].map(action => `/v1/enterprise/${next}/${family}:${action}`)))
      for (const call of calls.slice(before)) {
        assert.equal(call.headers['x-hzy-scheduler-generation'], '7')
        assert.equal(call.headers['x-hzy-actor-uid'], undefined)
        assert.equal(call.headers['x-hzy-actor-purpose'], undefined)
      }
    }
    deadMode = true
    for (const next of ['altoc', 'finance', 'people'] as const) {
      domain = next
      const before = calls.length
      assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
      assert.deepEqual(calls.slice(before).map(call => call.path), ['pending-dead-letter-actionables', 'dead-letter-actionable-published', 'pending-dead-letter-closures', 'dead-letter-closure-acknowledged'].map(operation => `/v1/enterprise/${next}/${operation}`))
      for (const call of calls.slice(before)) {
        assert.equal(call.headers['x-hzy-scheduler-generation'], '7')
        assert.equal(call.headers['x-hzy-actor-uid'], undefined)
        assert.equal(call.headers['x-hzy-actor-purpose'], undefined)
      }
    }
    domain = 'altoc'
    for (const wrong of ['people.runtime', 'opaque']) {
      client = wrong
      setLocalServiceTokenIssuer(issue)
      const before = calls.length
      assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 403)
      assert.equal(calls.length, before)
    }
    client = 'enterprise.runtime'
    setLocalServiceTokenIssuer(issue)
    const beforeDisabled = calls.length
    delete process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED
    assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 503)
    assert.equal(calls.length, beforeDisabled)
    cloudflareFlag = 'true'
    assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 200)
    cloudflareFlag = 'false'
    process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED = 'true'
    assert.equal((await fetch(url, { method: 'POST', headers: headers() })).status, 503)
    cloudflareFlag = undefined
    const afterCloudflare = calls.length
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers(), 'x-hzy-apf-domain': 'people' } })).status, 403)
    assert.equal(calls.length, afterCloudflare)
    const before = calls.length
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers(), 'x-hzy-scheduler-generation': '8' } })).status, 403)
    assert.equal(calls.length, before)
  } finally {
    if (previousFlag === undefined) delete process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED
    else process.env.HZY_ENTERPRISE_APF_SCHEDULER_ENABLED = previousFlag
    setLocalServiceTokenIssuer(null)
    globals.useRuntimeConfig = previous
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => runtime.close(() => resolve()))])
  }
})
