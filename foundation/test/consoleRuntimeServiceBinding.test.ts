import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getConsoleRuntimeConfig } from '../server/utils/consoleRuntime.ts'

/**
 * 生产 zone `huizhi.yun` 的 `CN_CA_JP` WAF 规则 block 掉
 * `ip.src.country ∉ {CA, CN, JP}` 的请求。cron 触发的 Worker 子请求没有访客上下文、
 * 被 Cloudflare 归属为 `country=US`，因此走公网访问 Console 会稳定 403 ——
 * 2026-08-23 firewall events 证实 aims/altoc/people/workflow 四个 drain 全部被拦。
 *
 * 因此托管云 Worker 必须走 `HZY_CONSOLE_SERVICE` Service Binding（Worker 间直连，
 * 不经过边缘）；没有 binding 的部署也必须带上 bypass 规则识别的 Worker UA。
 */

const originalFetch = (globalThis as { $fetch?: unknown }).$fetch
const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig

afterEach(() => {
  ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
  ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
})

const consoleUrl = 'https://console.example.test'

function runtimeEnvelope(appCode: string) {
  return {
    code: 0,
    data: {
      schemaVersion: 'console-runtime.v1',
      app: { appCode, appName: appCode },
      console: {
        baseUrl: consoleUrl,
        issuer: consoleUrl,
        tokenUrl: `${consoleUrl}/oauth/token`,
        bootstrapTokenUrl: `${consoleUrl}/api/v1/console/bootstrap/token`,
        authMeUrl: `${consoleUrl}/api/v1/console/auth/me`,
        directoryApiUrl: `${consoleUrl}/api/v1/console/directory`,
        settingsApiUrl: `${consoleUrl}/api/v1/console/settings`,
        integrationsApiUrl: `${consoleUrl}/api/v1/console/integrations`,
        userApplicationsUrl: `${consoleUrl}/api/user/applications`
      },
      fetchedAt: '2026-08-23T22:00:00.000Z'
    }
  }
}

const emptyNode = { req: { headers: {}, method: 'GET', url: '/' }, res: {} }
// h3 的 getRequestURL 读 event.path；纯对象 event 需要显式提供
const eventBase = { node: emptyNode, path: '/', method: 'GET' }

function bindingEvent(appCode: string, calls: { url: string, headers: Record<string, string> }[]) {
  return {
    ...eventBase,
    context: {
      _platform: {
        cloudflare: {
          env: {
            HZY_CONSOLE_SERVICE: {
              fetch: async (input: string | URL, init?: RequestInit) => {
                const headers: Record<string, string> = {}
                new Headers(init?.headers).forEach((v, k) => {
                  headers[k] = v
                })
                calls.push({ url: String(input), headers })
                return new Response(JSON.stringify(runtimeEnvelope(appCode)), {
                  status: 200,
                  headers: { 'content-type': 'application/json' }
                })
              }
            }
          }
        }
      }
    }
  } as never
}

test('uses the Console Service Binding instead of the public edge', async () => {
  const appCode = `binding-app-${Date.now()}`
  const calls: { url: string, headers: Record<string, string> }[] = []
  let publicFetchCalls = 0

  ;(globalThis as { useRuntimeConfig?: () => Record<string, unknown> }).useRuntimeConfig = () => ({
    hzy: { appCode, consoleRuntimeApiUrl: consoleUrl, consoleRuntimeEnabled: true }
  })
  ;(globalThis as { $fetch?: unknown }).$fetch = async () => {
    publicFetchCalls += 1
    throw new Error('public edge fetch must not be used when a Service Binding exists')
  }

  const config = await getConsoleRuntimeConfig({
    appCode,
    event: bindingEvent(appCode, calls)
  } as never)

  assert.equal(publicFetchCalls, 0, '存在 Service Binding 时不得走公网')
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/api\/v1\/console\/runtime\/apps\//)
  assert.equal(config.console.baseUrl, consoleUrl)
})

test('sends the WAF bypass Worker user-agent on the HTTP fallback', async () => {
  const appCode = `fallback-app-${Date.now()}`
  const seen: Record<string, string>[] = []

  ;(globalThis as { useRuntimeConfig?: () => Record<string, unknown> }).useRuntimeConfig = () => ({
    hzy: { appCode, consoleRuntimeApiUrl: consoleUrl, consoleRuntimeEnabled: true }
  })
  ;(globalThis as { $fetch?: unknown }).$fetch = async (
    _url: string,
    options: { headers?: Record<string, string> }
  ) => {
    seen.push(options.headers || {})
    return runtimeEnvelope(appCode)
  }

  // 没有 Service Binding 的部署（自托管 / 本地）
  await getConsoleRuntimeConfig({ appCode, event: { ...eventBase, context: {} } } as never)

  assert.equal(seen.length, 1)
  assert.equal(
    seen[0]!['user-agent'],
    'HZY-Cloudflare-Worker/1.0',
    '缺少该 UA 会被生产 CN_CA_JP WAF 规则拦成 403'
  )
})
