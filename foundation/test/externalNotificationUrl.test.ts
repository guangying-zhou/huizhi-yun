import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { externalNotificationActionUrl, resolveExternalNotificationActionUrl } from '../server/utils/notify.ts'

const relative = '/codocs/documents/CLAUDE-FIXTURE?fromCollab=1#content'
test('external link contract uses each tenant deployment entry for all external adapters', () => {
  for (const channel of ['wecom', 'dingtalk', 'email']) {
    for (const base of ['https://aidcp.wiztek.cn', 'https://tenant.huizhi.yun', 'https://hzy0.isme.dev']) {
      assert.equal(externalNotificationActionUrl(relative, base), base + relative, channel)
      assert.equal(externalNotificationActionUrl(relative, base + '/enterprise/'), base + relative)
    }
  }
  assert.equal(externalNotificationActionUrl('https://registered.example.test/activate?k=fixture', ''), 'https://registered.example.test/activate?k=fixture')
})
test('relative external links cannot select another origin; invalid or missing config fails closed', () => {
  for (const value of ['//evil.test/path', '/\\evil.test/path', 'javascript:alert(1)', 'mailto:test@example.test', 'https://user:secret@example.test', '/path\nHeader:x']) {
    assert.throws(() => externalNotificationActionUrl(value, 'https://aidcp.wiztek.cn'), { statusCode: 400 })
  }
  for (const base of ['', '/relative', 'javascript:x', 'https://user:secret@example.test', 'https://tenant.test/?query=x', 'https://tenant.test/#hash']) {
    assert.throws(() => externalNotificationActionUrl(relative, base), { statusCode: 503 })
  }
})
test('self-hosted process config, Cloudflare binding config and hzy0 config ignore forged host headers', async () => {
  const globals = globalThis as { useRuntimeConfig?: unknown }
  const before = globals.useRuntimeConfig
  const names = ['HZY_DEPLOYMENT_PUBLIC_URL', 'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL']
  const env = names.map(name => process.env[name])
  try {
    names.forEach(name => Reflect.deleteProperty(process.env, name))
    globals.useRuntimeConfig = () => ({ public: { deploymentPublicUrl: 'https://hzy0.isme.dev' } })
    const forged = { node: { req: { headers: { 'host': 'evil.test', 'x-forwarded-host': 'evil.test', 'x-hzy-forwarded-host': 'evil.test' } } }, context: {} } as never
    assert.equal(await resolveExternalNotificationActionUrl(relative, forged), 'https://hzy0.isme.dev' + relative)
    process.env.HZY_DEPLOYMENT_PUBLIC_URL = 'https://aidcp.wiztek.cn'
    assert.equal(await resolveExternalNotificationActionUrl(relative, forged), 'https://aidcp.wiztek.cn' + relative)
    const cf = { ...forged as object, context: { cloudflare: { env: { HZY_DEPLOYMENT_PUBLIC_URL: 'https://tenant.huizhi.yun' } } } } as never
    assert.equal(await resolveExternalNotificationActionUrl(relative, cf), 'https://tenant.huizhi.yun' + relative)
  } finally {
    globals.useRuntimeConfig = before
    names.forEach((name, i) => {
      if (env[i] === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = env[i]
    })
  }
})
test('production external boundary normalizes the URL while the durable in-app action remains unchanged', () => {
  const source = readFileSync(new URL('../server/utils/notify.ts', import.meta.url), 'utf8')
  assert.match(source, /url: await resolveExternalNotificationActionUrl\(params.url, params.event\)/)
  assert.match(source, /sendViaNotificationRuntime\(externalParams, touser, target\)/)
  assert.match(source, /actionUrl: params.inAppUrl \?\? params.url/)
})
test('missing deployment env resolves only the Console runtime deployment publicUrl', async () => {
  const globals = globalThis as { useRuntimeConfig?: unknown }
  const before = globals.useRuntimeConfig
  const names = ['HZY_DEPLOYMENT_PUBLIC_URL', 'NUXT_PUBLIC_DEPLOYMENT_PUBLIC_URL']
  const saved = names.map(name => process.env[name])
  try {
    names.forEach(name => Reflect.deleteProperty(process.env, name))
    globals.useRuntimeConfig = () => ({ hzy: { appCode: 'notification-url-fixture', consoleApiUrl: 'https://config.example.test/console', consoleRuntimeEnabled: true } })
    const binding = { fetch: async () => new Response(JSON.stringify({ code: 0, data: {
      schemaVersion: 'console-runtime.v1', app: { appCode: 'notification-url-fixture', appName: 'Fixture' },
      console: { baseUrl: 'https://config.example.test/console', tokenUrl: 'https://config.example.test/console/oauth/token' },
      deployment: { publicUrl: 'https://registered-tenant.example.test' }, fetchedAt: '2026-10-07T00:00:00Z'
    } }), { status: 200, headers: { 'content-type': 'application/json' } }) }
    const event = { path: '/', method: 'GET', context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: binding } } }, node: { req: { headers: { 'host': 'evil.test', 'x-forwarded-host': 'evil.test' } } } } as never
    assert.equal(await resolveExternalNotificationActionUrl(relative, event), 'https://registered-tenant.example.test' + relative)
  } finally {
    globals.useRuntimeConfig = before
    names.forEach((name, i) => {
      if (saved[i] === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = saved[i]
    })
  }
})
