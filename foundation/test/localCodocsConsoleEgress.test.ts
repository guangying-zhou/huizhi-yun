import assert from 'node:assert/strict'
import test from 'node:test'
import { schedulerRequestHeaders } from '../../deploy/cloudflare/tenant-gateway/src/index.js'
import { installLocalCodocsConsoleEgress } from '../server/utils/localCodocsConsoleEgress'
import { localCodocsEgressCredential } from '../shared/utils/localCodocsEgressCredential'

const path = '/codocs/api/v1/service/company-weekly-summaries/2026-W40:publish'
const secret = 'fixture-secret-for-codocs-local-only-0123456789'

test('local Codocs Console egress requires fresh signed Gateway context and exact hzy0 binding', async () => {
  const keys = ['HZY0_CODOCS_LOCAL_ONLY', 'HZY0_LOCAL_ENTERPRISE', 'HZY0_CONSOLE_EGRESS_URL', 'HZY0_GATEWAY_INTERNAL_TOKEN', 'HZY_CODOCS_SERVICE_CLIENT_SECRET'] as const
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const previous = globals.useRuntimeConfig
  const previousFetch = globalThis.fetch
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { codocs: { deploymentCode: 'C000001-test-codocs' } },
    dataRuntime: { endpoint: 'https://hzy-test-runtime.isme.dev', audience: 'data-runtime' } }
  const signed = await schedulerRequestHeaders({ HZY_TENANT_GATEWAY_INTERNAL_TOKEN: secret }, tenant,
    'hzy0.isme.dev', 'codocs', 'codocs-fixture-1', String(Date.now()), '', path)
  const headers = Object.fromEntries(signed.entries())
  const event = (changes: Record<string, string> = {}, requestPath = path) => ({
    path: requestPath, context: {}, node: { req: { url: requestPath, headers: { host: 'hzy0.isme.dev', ...headers, ...changes } } }
  }) as never
  try {
    process.env.HZY0_CODOCS_LOCAL_ONLY = 'true'
    process.env.HZY0_LOCAL_ENTERPRISE = 'true'
    process.env.HZY0_CONSOLE_EGRESS_URL = 'http://127.0.0.1:23121'
    process.env.HZY0_GATEWAY_INTERNAL_TOKEN = secret
    process.env.HZY_CODOCS_SERVICE_CLIENT_SECRET = 'codocs-service-fixture-secret-0123456789'
    globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: secret } })
    const accepted = event() as { context: { hzyConsoleTransport?: { fetch: (url: string) => Promise<unknown> } } }
    await installLocalCodocsConsoleEgress(accepted as never)
    assert.equal(typeof accepted.context.hzyConsoleTransport?.fetch, 'function')
    await assert.rejects(() => accepted.context.hzyConsoleTransport!.fetch('https://other.example.test/oauth/introspect'))
    let localDial = false
    globalThis.fetch = (async (input, init) => {
      const headers = new Headers(init?.headers)
      localDial = String(input) === 'http://127.0.0.1:23121/oauth/introspect'
        && init?.redirect === 'manual'
        && headers.get('x-hzy0-egress-token') === localCodocsEgressCredential('codocs-service-fixture-secret-0123456789')
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await accepted.context.hzyConsoleTransport!.fetch('https://hzy-test.huizhi.yun/oauth/introspect')
    assert.equal(localDial, true)
    for (const changes of [
      { 'x-hzy-gateway-token': 'forged' }, { 'x-hzy-scheduler-signature': 'forged' },
      { 'x-hzy-scheduler-issued-at': '1' }, { 'x-hzy-tenant': 'C000002' },
      { 'x-hzy-deployment': 'other' }, { 'x-hzy-app-code': 'aims' },
      { 'x-hzy-environment': 'prod' }
    ]) {
      const rejected = event(changes) as { context: { hzyConsoleTransport?: unknown } }
      await installLocalCodocsConsoleEgress(rejected as never)
      assert.equal(rejected.context.hzyConsoleTransport, undefined, JSON.stringify(changes))
    }
    const otherPath = event({}, '/codocs/api/v1/service/product-documents/create') as { context: { hzyConsoleTransport?: unknown } }
    await installLocalCodocsConsoleEgress(otherPath as never)
    assert.equal(otherPath.context.hzyConsoleTransport, undefined)
    process.env.HZY0_CODOCS_LOCAL_ONLY = 'false'
    const off = event() as { context: { hzyConsoleTransport?: unknown } }
    await installLocalCodocsConsoleEgress(off as never)
    assert.equal(off.context.hzyConsoleTransport, undefined)
    process.env.HZY0_CODOCS_LOCAL_ONLY = 'true'
    process.env.HZY0_LOCAL_ENTERPRISE = 'false'
    const cloud = event() as { context: { hzyConsoleTransport?: unknown } }
    await installLocalCodocsConsoleEgress(cloud as never)
    assert.equal(cloud.context.hzyConsoleTransport, undefined)
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = before[key]
    }
    if (previous) globals.useRuntimeConfig = previous
    else delete globals.useRuntimeConfig
    globalThis.fetch = previousFetch
  }
})
