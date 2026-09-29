import assert from 'node:assert/strict'
import test from 'node:test'
import { requireTenantGatewaySchedulerRequest } from '../../foundation/server/utils/tenantGatewayTrust'
import { installLocalCodocsConsoleEgress } from '../../foundation/server/utils/localCodocsConsoleEgress'
import { schedulerRequestHeaders } from '../../deploy/cloudflare/tenant-gateway/src/index.js'
import { localCodocsSchedulerHeaders, localUnifiedCompanySummaryCodocsHeaders } from '../server/utils/localCodocsSchedulerHeaders'

test('local W40 delivery receives a fresh target-bound Gateway proof only with exact local binding', async () => {
  const keys = ['HZY0_CODOCS_LOCAL_ONLY', 'HZY0_LOCAL_CONSOLE_FACADE', 'HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY',
    'HZY_CODOCS_TARGET_DEPLOYMENT', 'HZY_CODOCS_SERVICE_BASE_URL', 'HZY_TENANT_RUNTIME_TENANT', 'HZY_TENANT_RUNTIME_URL',
    'HZY_PLATFORM_ENVIRONMENT', 'HZY0_GATEWAY_INTERNAL_TOKEN'] as const
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  const path = '/codocs/api/v1/service/company-weekly-summaries/2026-W40:publish'
  try {
    const secret = 'fixture-secret-for-codocs-local-only-0123456789'
    const enabled: Record<string, string> = {
      HZY0_CODOCS_LOCAL_ONLY: 'true', HZY0_LOCAL_CONSOLE_FACADE: 'true',
      HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY: 'true', HZY_CODOCS_TARGET_DEPLOYMENT: 'C000001-test-codocs',
      HZY_CODOCS_SERVICE_BASE_URL: 'http://127.0.0.1:23130/codocs',
      HZY_TENANT_RUNTIME_TENANT: 'C000001', HZY_TENANT_RUNTIME_URL: 'https://hzy-test-runtime.isme.dev',
      HZY_PLATFORM_ENVIRONMENT: 'test', HZY0_GATEWAY_INTERNAL_TOKEN: secret
    }
    Object.assign(process.env, enabled)
    globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: secret } })
    const signed = await localCodocsSchedulerHeaders(path, 'C000001-test-codocs', 'codocs-fixture-1')
    assert.equal(signed['x-hzy-app-code'], 'codocs')
    assert.equal(signed['x-hzy-deployment'], 'C000001-test-codocs')
    const event = (headers: Record<string, string>) => ({ node: { req: { headers } }, context: {} }) as never
    assert.equal((await requireTenantGatewaySchedulerRequest(event(signed), 'codocs', path)).tenant, 'C000001')
    await assert.rejects(requireTenantGatewaySchedulerRequest(event({ ...signed, 'x-hzy-scheduler-issued-at': '1' }), 'codocs', path))
    for (const [key, value] of Object.entries(enabled)) {
      process.env[key] = key === 'HZY0_CODOCS_LOCAL_ONLY' || key === 'HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY' ? 'false' : 'wrong'
      assert.deepEqual(await localCodocsSchedulerHeaders(path, 'C000001-test-codocs', 'codocs-fixture-2'), {}, key)
      process.env[key] = value
    }
    assert.deepEqual(await localCodocsSchedulerHeaders(path, 'other', 'codocs-fixture-3'), {})
    assert.deepEqual(await localCodocsSchedulerHeaders('/codocs/api/v1/service/product-documents/create', 'C000001-test-codocs', 'codocs-fixture-4'), {})
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = prior[key]
    }
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
  }
})

test('verified Aims unified wake mints a Codocs target proof and reaches local Console egress', async () => {
  const keys = ['HZY0_CODOCS_LOCAL_ONLY', 'HZY0_LOCAL_CONSOLE_FACADE', 'HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY',
    'HZY_CODOCS_TARGET_DEPLOYMENT', 'HZY_CODOCS_SERVICE_BASE_URL', 'HZY_TENANT_RUNTIME_TENANT',
    'HZY_TENANT_RUNTIME_URL', 'HZY_PLATFORM_ENVIRONMENT', 'HZY0_GATEWAY_INTERNAL_TOKEN',
    'HZY0_LOCAL_ENTERPRISE', 'HZY0_CONSOLE_EGRESS_URL', 'HZY_CODOCS_SERVICE_CLIENT_SECRET'] as const
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previousConfig = globals.useRuntimeConfig
  const previousFetch = globalThis.fetch
  const secret = 'fixture-secret-for-codocs-local-only-0123456789'
  const publishPath = '/codocs/api/v1/service/company-weekly-summaries/2026-W40:publish'
  const drainPath = '/api/internal/integration-operations/drain'
  const operation = { tenantCode: 'C000001', deploymentCode: 'C000001-test-aims', operationCode: 'aims.company-weekly-summary.codocs-publish.v1' }
  try {
    Object.assign(process.env, {
      HZY0_CODOCS_LOCAL_ONLY: 'true', HZY0_LOCAL_CONSOLE_FACADE: 'true',
      HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY: 'true', HZY_CODOCS_TARGET_DEPLOYMENT: 'C000001-test-codocs',
      HZY_CODOCS_SERVICE_BASE_URL: 'http://127.0.0.1:23130/codocs',
      HZY_TENANT_RUNTIME_TENANT: 'C000001', HZY_TENANT_RUNTIME_URL: 'https://hzy-test-runtime.isme.dev',
      HZY_PLATFORM_ENVIRONMENT: 'test', HZY0_GATEWAY_INTERNAL_TOKEN: secret,
      HZY0_LOCAL_ENTERPRISE: 'true', HZY0_CONSOLE_EGRESS_URL: 'http://127.0.0.1:23121',
      // Codocs' local Console egress derives its credential from this service secret.
      HZY_CODOCS_SERVICE_CLIENT_SECRET: 'fixture-codocs-service-secret-abcdefghijklmnop'
    })
    globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: secret } })
    const tenant = { tenantCode: 'C000001', environment: 'test', apps: { aims: { deploymentCode: 'C000001-test-aims', enterpriseScheduler: { storage: 'unified', generation: '7' } } },
      dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', audience: 'data-runtime' } }
    const inbound = await schedulerRequestHeaders({ HZY_TENANT_GATEWAY_INTERNAL_TOKEN: secret }, tenant,
      'hzy0.isme.dev', 'aims', 'aims-wake-1', String(Date.now()), '', drainPath)
    const event = (headers: Headers, path: string) => ({ path, context: {}, node: { req: { url: path, headers: Object.fromEntries(headers.entries()) } } }) as never
    const verified = await requireTenantGatewaySchedulerRequest(event(inbound, drainPath), 'aims', drainPath)
    const target = await localUnifiedCompanySummaryCodocsHeaders(verified, operation, publishPath, 'C000001-test-codocs', 'codocs-wake-1')
    assert.equal(target['x-hzy-app-code'], 'codocs')
    assert.equal(target['x-hzy-deployment'], 'C000001-test-codocs')
    assert.notEqual(target['x-hzy-scheduler-signature'], inbound.get('x-hzy-scheduler-signature'))
    const codocsEvent = event(new Headers(target), publishPath) as { context: { hzyConsoleTransport?: { fetch: (url: string) => Promise<unknown> } } }
    await installLocalCodocsConsoleEgress(codocsEvent as never)
    assert.equal(typeof codocsEvent.context.hzyConsoleTransport?.fetch, 'function')
    let dial = ''
    globalThis.fetch = (async (url) => {
      dial = String(url)
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await codocsEvent.context.hzyConsoleTransport!.fetch('https://hzy-test.huizhi.yun/oauth/introspect')
    assert.equal(dial, 'http://127.0.0.1:23121/oauth/introspect')
    for (const rejected of [
      undefined,
      { ...verified, tenant: 'C000002' }, { ...verified, environment: 'prod' },
      { ...verified, deployment: 'other' }, { ...verified, schedulerStorage: '' }
    ]) assert.deepEqual(await localUnifiedCompanySummaryCodocsHeaders(rejected, operation, publishPath, 'C000001-test-codocs', 'codocs-wake-2'), {})
    assert.deepEqual(await localUnifiedCompanySummaryCodocsHeaders(verified, { ...operation, operationCode: 'aims.codocs.product-document.create.v1' }, publishPath, 'C000001-test-codocs', 'codocs-wake-3'), {})
    assert.deepEqual(await localUnifiedCompanySummaryCodocsHeaders(verified, operation, publishPath, 'other', 'codocs-wake-4'), {})
    assert.deepEqual(await localUnifiedCompanySummaryCodocsHeaders(verified, operation, '/codocs/api/v1/service/product-documents/create', 'C000001-test-codocs', 'codocs-wake-5'), {})
    for (const [name, value] of [['HZY0_COMPANY_SUMMARY_CODOCS_DELIVERY', 'false'], ['HZY_PLATFORM_ENVIRONMENT', 'prod']] as const) {
      process.env[name] = value
      assert.deepEqual(await localUnifiedCompanySummaryCodocsHeaders(verified, operation, publishPath, 'C000001-test-codocs', 'codocs-wake-6'), {})
      process.env[name] = name === 'HZY_PLATFORM_ENVIRONMENT' ? 'test' : 'true'
    }
    const forged = event(new Headers({ ...Object.fromEntries(inbound.entries()), 'x-hzy-scheduler-signature': 'forged' }), drainPath)
    await assert.rejects(requireTenantGatewaySchedulerRequest(forged, 'aims', drainPath))
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = prior[key]
    }
    if (previousConfig) globals.useRuntimeConfig = previousConfig
    else delete globals.useRuntimeConfig
    globalThis.fetch = previousFetch
  }
})
