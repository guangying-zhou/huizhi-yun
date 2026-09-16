import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { publishNotification } from '../server/utils/notifications.ts'
import { fetchRuntimeSettings } from '../server/utils/runtimeSettings.ts'
import { setLocalServiceTokenIssuer } from '../server/utils/serviceOidc.ts'

const originalFetch = (globalThis as { $fetch?: unknown }).$fetch
const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig

afterEach(() => {
  setLocalServiceTokenIssuer(null)
  if (originalFetch === undefined) {
    delete (globalThis as { $fetch?: unknown }).$fetch
  } else {
    ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
  }
  if (originalRuntimeConfig === undefined) {
    delete (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
  } else {
    ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
  }
})

function installConsoleBindingHarness(appCode: string) {
  const calls: Array<{ url: string, headers: Record<string, string>, method: string }> = []
  ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
    hzy: {
      appCode,
      consoleUrl: 'https://console.example.test',
      cloudflareInternalToken: 'trusted-gateway-token'
    },
    public: {
      appCode,
      consoleUrl: 'https://console.example.test'
    }
  })
  ;(globalThis as { $fetch?: unknown }).$fetch = async () => {
    throw new Error('public Console fetch must not be used when a Service Binding is available')
  }
  setLocalServiceTokenIssuer(async () => 'service-access-token')

  const event = {
    context: {
      cloudflare: {
        env: {
          HZY_CONSOLE_SERVICE: {
            async fetch(input: string | URL | Request, init?: RequestInit) {
              const url = input instanceof Request ? input.url : String(input)
              calls.push({
                url,
                headers: Object.fromEntries(new Headers(init?.headers)),
                method: String(init?.method || 'GET')
              })
              const pathname = new URL(url).pathname
              if (pathname.includes('/runtime/apps/')) {
                return Response.json({
                  code: 0,
                  data: {
                    schemaVersion: 'console-runtime.v1',
                    app: { appCode, appName: appCode },
                    console: {
                      baseUrl: 'https://console.example.test',
                      tokenUrl: 'https://console.example.test/oauth/token',
                      bootstrapTokenUrl: 'https://console.example.test/oauth/bootstrap-token',
                      authMeUrl: 'https://console.example.test/api/v1/console/auth/me',
                      directoryApiUrl: 'https://console.example.test/api/v1/console/directory',
                      settingsApiUrl: 'https://console.example.test/api/v1/console/settings',
                      integrationsApiUrl: 'https://console.example.test/api/v1/console/integrations',
                      userApplicationsUrl: 'https://console.example.test/api/v1/console/applications'
                    },
                    fetchedAt: new Date().toISOString()
                  }
                })
              }
              if (pathname === '/api/v1/console/settings/values') {
                return Response.json({
                  code: 0,
                  data: {
                    items: [{ settingKey: 'feedback.notify.wecomUsers', value: 'zhouguangying' }]
                  }
                })
              }
              if (pathname === '/api/v1/console/notifications/publish') {
                return Response.json({
                  code: 0,
                  data: {
                    notificationId: 'notification-1',
                    sourceAppCode: 'aims',
                    recipients: ['zhouguangying'],
                    channels: ['wecom']
                  }
                })
              }
              return Response.json({ message: 'unexpected Console request' }, { status: 404 })
            }
          }
        }
      }
    },
    node: {
      req: {
        headers: {
          'x-hzy-gateway': 'tenant-gateway',
          'x-hzy-gateway-token': 'trusted-gateway-token',
          'x-hzy-tenant': 'C000001',
          'x-hzy-deployment': `C000001-${appCode}`,
          'x-hzy-environment': 'prod',
          'x-hzy-app-code': appCode,
          'x-forwarded-host': 'wiztek.huizhi.yun',
          'x-forwarded-proto': 'https',
          'x-forwarded-prefix': `/${appCode}`,
          'x-hzy-data-runtime-url': 'https://runtime.example.test',
          'x-hzy-data-runtime-code': 'runtime-prod',
          'x-hzy-data-runtime-token': 'runtime-bootstrap-token',
          'x-hzy-data-runtime-audience': 'data-runtime'
        },
        url: `/${appCode}/api/test`
      }
    }
  } as never

  return { calls, event }
}

test('request-bound runtime settings preserve Tenant Gateway context', () => {
  const utilityPath = fileURLToPath(new URL('../server/utils/runtimeSettings.ts', import.meta.url))
  const routePath = fileURLToPath(new URL('../server/api/runtime/feedback-reporter.get.ts', import.meta.url))
  const feedbackNotifyPath = fileURLToPath(new URL('../server/utils/feedbackNotify.ts', import.meta.url))
  const notifyPath = fileURLToPath(new URL('../server/utils/notify.ts', import.meta.url))
  const utility = readFileSync(utilityPath, 'utf8')
  const route = readFileSync(routePath, 'utf8')
  const feedbackNotify = readFileSync(feedbackNotifyPath, 'utf8')
  const notify = readFileSync(notifyPath, 'utf8')

  assert.match(utility, /getConsoleRuntimeConfig\(\{ event \}\)/)
  assert.match(utility, /requestServiceAccessToken\(\{[\s\S]*scope: 'system_settings:view',[\s\S]*event/)
  assert.match(utility, /fetchRuntimeSettings\(\[settingKey\], options\.event\)/)
  assert.match(route, /defineEventHandler\(async \(event\)/)
  assert.match(route, /ttlMs: 60000,[\s\S]*event/)
  assert.match(
    feedbackNotify,
    /getRuntimeSetting<string>\('feedback\.notify\.wecomUsers',[\s\S]*?\{\s*ttlMs: 60000,\s*event\s*\}\)/
  )
  assert.match(
    notify,
    /getRuntimeSetting<boolean>\('connector\.notificationsEnabled',[\s\S]*?\{\s*ttlMs: 15000,\s*event: event \|\| undefined\s*\}\)/
  )
  assert.match(
    notify,
    /getRuntimeSetting<string>\('connector\.runtimeApiUrl',[\s\S]*?\{\s*ttlMs: 15000,\s*event: event \|\| undefined\s*\}\)/
  )
  assert.match(
    notify,
    /getRuntimeSetting<string>\('notification\.runtimeApiUrl',[\s\S]*?\{\s*ttlMs: 60000,\s*event: event \|\| undefined\s*\}\)/
  )
})

test('runtime settings use the Console Service Binding with trusted tenant context', async () => {
  const { calls, event } = installConsoleBindingHarness('aims-settings-regression')

  const settings = await fetchRuntimeSettings(['feedback.notify.wecomUsers'], event)

  assert.deepEqual(settings, { 'feedback.notify.wecomUsers': 'zhouguangying' })
  const settingsCall = calls.find(call => new URL(call.url).pathname === '/api/v1/console/settings/values')
  assert.ok(settingsCall)
  assert.equal(settingsCall.headers.authorization, 'Bearer service-access-token')
  assert.equal(settingsCall.headers['x-hzy-tenant'], 'C000001')
  assert.equal(settingsCall.headers['x-hzy-data-runtime-url'], 'https://runtime.example.test')
})

test('notification publishing uses the Console Service Binding with trusted tenant context', async () => {
  const { calls, event } = installConsoleBindingHarness('aims-notification-regression')

  const result = await publishNotification({
    sourceAppCode: 'aims',
    eventType: 'feedback.created',
    title: 'New feedback',
    idempotencyKey: 'feedback:10',
    recipients: ['zhouguangying'],
    channels: ['wecom'],
    event
  })

  assert.equal(result.notificationId, 'notification-1')
  const publishCall = calls.find(call => new URL(call.url).pathname === '/api/v1/console/notifications/publish')
  assert.ok(publishCall)
  assert.equal(publishCall.method, 'POST')
  assert.equal(publishCall.headers.authorization, 'Bearer service-access-token')
  assert.equal(publishCall.headers['x-hzy-tenant'], 'C000001')
  assert.equal(publishCall.headers['x-hzy-data-runtime-token'], 'runtime-bootstrap-token')
})
