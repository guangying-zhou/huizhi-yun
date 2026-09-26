import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../server/plugins/local-policy-egress.ts', import.meta.url), 'utf8')
const compiled = ts.transpile(source.replace(/^import .*\n/, '').replace('export default ', ''), { target: ts.ScriptTarget.ES2022 })
type Event = { context: Record<string, unknown>, path?: string }
type Binding = { fetch: (url: string, init?: RequestInit) => Promise<Response> }

test('local policy adapter requires explicit mode and trusted Console identity; pins all remote request fields', async () => {
  const calls: { url: string, init: RequestInit }[] = []
  const env = { HZY0_LOCAL_CONSOLE_FACADE: 'true', HZY0_POLICY_EGRESS_URL: 'http://127.0.0.1:23121/__hzy0/platform-policy',
    HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'verified-runtime', HZY0_GATEWAY_INTERNAL_TOKEN: 'local-fixture' }
  let trusted: unknown = { tenant: 'C000001', environment: 'test', appCode: 'console', deployment: 'wiztek-test-console' }
  let hook: ((event: Event) => void) | undefined
  const install = () => new Function('defineNitroPlugin', 'resolveTrustedTenantGatewayContext', 'process', 'fetch', compiled)(
    (plugin: (nitro: unknown) => void) => plugin({ hooks: { hook: (_name: string, handler: (event: Event) => void) => { hook = handler } } }),
    () => trusted, { env }, async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return Response.json({ body: 'unchanged' })
    })
  install()
  const event: Event = { context: {}, path: '/api/internal/policy-bundle/sync' }
  hook!(event)
  const binding = event.context.hzyPlatformTransport as Binding
  const url = 'https://hzy.wiztek.cn/api/platform/internal/console/tenants/C000001/bundle?format=hzy-policy-envelope.v1&environment=test&deploymentCode=wiztek-test-console'
  await binding.fetch(url, { headers: { authorization: 'Bearer caller-secret', cookie: 'private=1' } })
  assert.equal(calls[0]!.url, env.HZY0_POLICY_EGRESS_URL)
  assert.deepEqual(calls[0]!.init.headers, { 'x-hzy0-egress-token': 'local-fixture' })
  assert.equal(calls[0]!.init.redirect, 'error')
  for (const target of [url.replace('https:', 'http:'), url.replace('hzy.wiztek.cn', 'evil.test'),
    url.replace('C000001', 'C000002'), url.replace('environment=test', 'environment=prod'),
    `${url}&version=old`, `${url}&format=hzy-policy-envelope.v1`, `${url}#fragment`, url.replace('https://', 'https://user:pass@')]) {
    await assert.rejects(binding.fetch(target), /Unapproved/)
  }
  await assert.rejects(binding.fetch(url, { method: 'POST' }), /Unapproved/)
  await assert.rejects(binding.fetch(url, { body: '{}' }), /Unapproved/)
  await assert.rejects(binding.fetch(url.replace('hzy-policy-envelope.v1', 'hzy-policy-bundle.v0')), /Unapproved/)
  assert.equal(calls.length, 1)
  await binding.fetch(url.replace('hzy-policy-envelope.v1', 'hzy-policy-revision.v1'))
  assert.equal(calls[1]!.url, `${env.HZY0_POLICY_EGRESS_URL}-revision`)
  assert.deepEqual(calls[1]!.init.headers, { 'x-hzy0-egress-token': 'local-fixture' })
  const serviceEvent: Event = { context: {}, path: '/api/v1/console/service/authorization/role-holders' }
  hook!(serviceEvent)
  await (serviceEvent.context.hzyPlatformTransport as Binding).fetch(url.replace('hzy-policy-envelope.v1', 'hzy-policy-revision.v1'))
  assert.equal(calls[2]!.url, `${env.HZY0_POLICY_EGRESS_URL}-revision-live`)
  const unrelatedEvent: Event = { context: {}, path: '/api/v1/console/profile' }
  hook!(unrelatedEvent)
  await assert.rejects((unrelatedEvent.context.hzyPlatformTransport as Binding).fetch(url.replace('hzy-policy-envelope.v1', 'hzy-policy-revision.v1')), /Unapproved policy source/)
  calls.length = 1
  for (const context of [null, { tenant: 'C000001', environment: 'test', appCode: 'enterprise', deployment: 'C000001-test-enterprise' },
    { tenant: 'C000002', environment: 'test', appCode: 'console', deployment: 'wiztek-test-console' }]) {
    trusted = context
    const untrusted: Event = { context: {} }
    hook!(untrusted)
    assert.equal(untrusted.context.hzyPlatformTransport, undefined)
  }
  env.HZY0_POLICY_EGRESS_URL = 'http://evil.test'
  assert.throws(install, /Invalid policy egress/)
})
