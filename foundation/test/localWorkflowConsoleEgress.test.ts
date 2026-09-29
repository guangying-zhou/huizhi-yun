import assert from 'node:assert/strict'
import test from 'node:test'
import { installLocalWorkflowConsoleEgress } from '../server/utils/localWorkflowConsoleEgress'

test('local Workflow Console transport requires the exact signed app deployment', async () => {
  const before = {
    local: process.env.HZY0_WORKFLOW_LOCAL_ONLY,
    endpoint: process.env.HZY0_CONSOLE_EGRESS_URL,
    token: process.env.HZY0_GATEWAY_INTERNAL_TOKEN
  }
  const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
  const priorConfig = globals.useRuntimeConfig
  process.env.HZY0_WORKFLOW_LOCAL_ONLY = 'true'
  process.env.HZY0_CONSOLE_EGRESS_URL = 'http://127.0.0.1:23121'
  process.env.HZY0_GATEWAY_INTERNAL_TOKEN = 'fixture-secret'
  globals.useRuntimeConfig = () => ({ hzy: { cloudflareInternalToken: 'fixture-secret' } })
  const event = (appCode: string, deployment: string) => ({ context: {}, node: { req: { headers: {
    'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'fixture-secret',
    'x-hzy-tenant': 'C000001', 'x-hzy-environment': 'test', 'x-hzy-app-code': appCode,
    'x-hzy-deployment': deployment, 'x-forwarded-host': 'hzy0.isme.dev'
  } } } }) as never
  try {
    for (const [app, deployment] of [['aims', 'C000001-test-aims'], ['workflow', 'C000001-test-workflow-local']] as const) {
      const accepted = event(app, deployment) as { context: { hzyConsoleTransport?: { fetch: (url: string) => Promise<unknown> } } }
      installLocalWorkflowConsoleEgress(accepted as never, app)
      assert.equal(typeof accepted.context.hzyConsoleTransport?.fetch, 'function')
      await assert.rejects(() => accepted.context.hzyConsoleTransport!.fetch('https://other.example.test/oauth/token'))
      const rejected = event(app, 'wrong') as { context: { hzyConsoleTransport?: unknown } }
      installLocalWorkflowConsoleEgress(rejected as never, app)
      assert.equal(rejected.context.hzyConsoleTransport, undefined)
    }
    process.env.HZY0_WORKFLOW_LOCAL_ONLY = 'false'
    const off = event('aims', 'C000001-test-aims') as { context: { hzyConsoleTransport?: unknown } }
    installLocalWorkflowConsoleEgress(off as never, 'aims')
    assert.equal(off.context.hzyConsoleTransport, undefined)
  } finally {
    for (const [name, value] of Object.entries({ HZY0_WORKFLOW_LOCAL_ONLY: before.local,
      HZY0_CONSOLE_EGRESS_URL: before.endpoint, HZY0_GATEWAY_INTERNAL_TOKEN: before.token })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    if (priorConfig) globals.useRuntimeConfig = priorConfig
    else delete globals.useRuntimeConfig
  }
})
