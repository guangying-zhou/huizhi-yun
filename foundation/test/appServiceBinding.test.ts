import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appServiceBindingName,
  appServiceBinding,
  normalizeAppServiceBindingUrl,
  serviceAppFetch
} from '../server/utils/appServiceBinding.ts'

// 走查 ISSUE-B-024：此前只有 HZY_CONSOLE_SERVICE 一条 Service Binding，
// 应用之间一律走 https://{租户网关}/{app}/ 公网地址。生产实测：
//   浏览器 POST 该地址 -> 正常路由到目标应用（401 要求服务令牌）
//   Worker  POST 同一地址 -> 目标 Worker 零入站，且不报错
// 原因与 Console 相同：Worker 子请求无访客上下文、被 WAF 归为 country=US 拦掉。

function eventWithEnv(env: Record<string, unknown>) {
  return { context: { cloudflare: { env } } } as never
}

describe('app service binding name', () => {
  test('maps app code to the binding the Cloudflare config renders', () => {
    assert.equal(appServiceBindingName('finance'), 'HZY_FINANCE_SERVICE')
    assert.equal(appServiceBindingName('aims'), 'HZY_AIMS_SERVICE')
    assert.equal(appServiceBindingName('Altoc'), 'HZY_ALTOC_SERVICE')
    assert.equal(appServiceBindingName('data-runtime'), 'HZY_DATA_RUNTIME_SERVICE')
  })

  test('rejects malformed app codes instead of fabricating a binding name', () => {
    for (const bad of ['', '  ', '1finance', 'fin ance', 'fin/ance', '../etc']) {
      assert.equal(appServiceBindingName(bad), '', `${bad} must not yield a binding name`)
    }
  })
})

describe('app service binding resolution', () => {
  test('returns the binding only when it exposes fetch', () => {
    const binding = { fetch: async () => new Response('{}') }
    assert.equal(appServiceBinding(eventWithEnv({ HZY_FINANCE_SERVICE: binding }), 'finance'), binding)
    assert.equal(appServiceBinding(eventWithEnv({ HZY_FINANCE_SERVICE: {} }), 'finance'), null)
    assert.equal(appServiceBinding(eventWithEnv({}), 'finance'), null)
    assert.equal(appServiceBinding(null, 'finance'), null)
  })

  test('does not cross-wire one app binding to another app', () => {
    const env = { HZY_FINANCE_SERVICE: { fetch: async () => new Response('{}') } }
    assert.notEqual(appServiceBinding(eventWithEnv(env), 'finance'), null)
    assert.equal(appServiceBinding(eventWithEnv(env), 'aims'), null)
  })
})

describe('binding url normalization', () => {
  // 生产实测（直连 workers.dev，等价于 Service Binding 路径）：
  //   POST /api/v1/finance/service/invoice-requests/create          -> 302（未匹配路由）
  //   POST /finance/api/v1/finance/service/invoice-requests/create  -> 401（正确匹配）
  // Finance 的 HZY_APP_BASE_PATH 是 /finance/，Worker 期望收到带前缀的路径。
  // Console 能剥 /console 只是因为它的 base path 是 /，那是特例不是通例。

  test('keeps the gateway app prefix by default', () => {
    const url = 'https://wiztek.huizhi.yun/finance/api/v1/finance/service/invoice-requests/create'
    assert.equal(normalizeAppServiceBindingUrl(url, 'finance'), url)
  })

  test('keeps the prefix when the target base path is not root', () => {
    const url = 'https://wiztek.huizhi.yun/finance/api/v1/finance/x'
    assert.equal(normalizeAppServiceBindingUrl(url, 'finance', { targetBasePath: '/finance/' }), url)
  })

  test('strips the prefix only when the target explicitly serves at root', () => {
    assert.equal(
      normalizeAppServiceBindingUrl(
        'https://wiztek.huizhi.yun/finance/api/v1/finance/service/x', 'finance', { targetBasePath: '/' }
      ),
      'https://wiztek.huizhi.yun/api/v1/finance/service/x'
    )
    assert.equal(
      normalizeAppServiceBindingUrl('https://wiztek.huizhi.yun/finance', 'finance', { targetBasePath: '/' }),
      'https://wiztek.huizhi.yun/'
    )
  })

  test('never strips a different app prefix even at root', () => {
    assert.equal(
      normalizeAppServiceBindingUrl('https://wiztek.huizhi.yun/altoc/api/v1/x', 'finance', { targetBasePath: '/' }),
      'https://wiztek.huizhi.yun/altoc/api/v1/x'
    )
  })

  test('does not truncate paths that merely start with the app name', () => {
    assert.equal(
      normalizeAppServiceBindingUrl('https://wiztek.huizhi.yun/financex/api', 'finance', { targetBasePath: '/' }),
      'https://wiztek.huizhi.yun/financex/api'
    )
  })
})

describe('service app fetch transport', () => {
  test('uses the matching binding and forwards request metadata and JSON body', async () => {
    let receivedUrl = ''
    let receivedInit: RequestInit | undefined
    const binding = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        receivedUrl = String(input)
        receivedInit = init
        return Response.json({ code: 0, data: { accepted: true } })
      }
    }

    const result = await serviceAppFetch<{ code: number, data: { accepted: boolean } }>(
      eventWithEnv({ HZY_FINANCE_SERVICE: binding }),
      'finance',
      'https://wiztek.huizhi.yun/finance/api/v1/finance/service/invoice-requests/create',
      {
        method: 'POST',
        headers: {
          'authorization': 'Bearer test-token',
          'idempotency-key': 'operation-1',
          // 调用方手写的目标上下文三字段必须被 applyTargetAppContext 剥除：
          // 它们只能来自受信的 x-hzy-service-routes 目录（本用例无目录）。
          'x-hzy-app-code': 'finance',
          'x-hzy-deployment': 'C000001-finance',
          'x-forwarded-prefix': '/finance'
        },
        body: { invoiceId: 42 }
      }
    )

    assert.deepEqual(result, { code: 0, data: { accepted: true } })
    assert.equal(receivedUrl, 'https://wiztek.huizhi.yun/finance/api/v1/finance/service/invoice-requests/create')
    assert.equal(receivedInit?.method, 'POST')
    assert.equal(new Headers(receivedInit?.headers).get('authorization'), 'Bearer test-token')
    assert.equal(new Headers(receivedInit?.headers).get('idempotency-key'), 'operation-1')
    // 无受信目录时，调用方手写的目标上下文三字段被剥除（不得冒充）
    assert.equal(new Headers(receivedInit?.headers).get('x-hzy-app-code'), null)
    assert.equal(new Headers(receivedInit?.headers).get('x-hzy-deployment'), null)
    assert.equal(new Headers(receivedInit?.headers).get('x-forwarded-prefix'), null)
    assert.equal(receivedInit?.body, JSON.stringify({ invoiceId: 42 }))
  })

  test('maps a binding non-2xx response to the shared service error shape', async () => {
    const binding = {
      async fetch() {
        return Response.json({ code: 'target_unavailable', message: 'Target unavailable' }, { status: 503 })
      }
    }

    await assert.rejects(
      () => serviceAppFetch(eventWithEnv({ HZY_FINANCE_SERVICE: binding }), 'finance', 'https://example.test/finance/api', {
        method: 'POST'
      }),
      (error: unknown) => {
        const value = error as { statusCode?: number, message?: string, data?: { code?: string } }
        assert.equal(value.statusCode, 503)
        assert.equal(value.message, 'Target unavailable')
        assert.equal(value.data?.code, 'target_unavailable')
        return true
      }
    )
  })

  test('uses the bounded public fallback with the internal Worker user agent when no binding exists', async () => {
    const runtime = globalThis as typeof globalThis & { $fetch?: unknown }
    const originalFetch = runtime.$fetch
    let receivedHeaders: Record<string, string> | undefined
    runtime.$fetch = async (_url: string, init: { headers: Record<string, string> }) => {
      receivedHeaders = init.headers
      return { code: 0 }
    }
    try {
      assert.deepEqual(
        await serviceAppFetch<{ code: number }>(null, 'finance', 'https://example.test/finance/api'),
        { code: 0 }
      )
      assert.equal(receivedHeaders?.['user-agent'], 'HZY-Cloudflare-Worker/1.0')
    } finally {
      runtime.$fetch = originalFetch
    }
  })
})

// —— 目标上下文三字段契约（根 CLAUDE.md：跨 Worker 直达必须原子改写
// x-hzy-app-code / x-hzy-deployment / x-forwarded-prefix，且契约测试必须同时断言三者）——
//
// 走查 ISSUE-B-025 的最终根因：目标应用向 Console 换自身 runtime 令牌时，
// runtimeAppIdentity 判据是受信网关上下文的 appCode === 自身 appCode。业务 Worker
// 没有 service client secret，这是唯一换牌途径。app-code 缺失或保留来源应用值，
// 目标端一律 503 "Console service client is not configured."（生产实测）。

const GATEWAY_TOKEN = 'test-gateway-internal-token'
const ROUTES_CATALOG = JSON.stringify({
  finance: { origin: 'https://finance.huizhi.yun', deploymentCode: 'C000001-finance', basePath: '/finance/' },
  aims: { origin: 'https://aims.huizhi.yun', deploymentCode: 'C000001-aims', basePath: '/aims/' }
})

function sourceContextHeaders(extra: Record<string, string> = {}) {
  // 模拟 Altoc 入站上下文：网关身份 + 来源应用自己的三字段 + 路由目录
  return {
    'x-hzy-gateway': 'tenant-gateway',
    'x-hzy-gateway-token': GATEWAY_TOKEN,
    'x-hzy-tenant': 'C000001',
    'x-hzy-deployment': 'C000001-altoc',
    'x-hzy-app-code': 'altoc',
    'x-forwarded-prefix': '/altoc',
    'x-hzy-service-routes': ROUTES_CATALOG,
    ...extra
  }
}

function bindingEvent(headers: Record<string, string>, captured: { headers?: Record<string, string> }) {
  const binding = {
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      captured.headers = Object.fromEntries(
        Object.entries((init?.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
      )
      return new Response('{"code":0}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    node: { req: { headers: lower } },
    headers: new Headers(lower),
    context: { cloudflare: { env: { HZY_FINANCE_SERVICE: binding, HZY_CLOUDFLARE_INTERNAL_TOKEN: GATEWAY_TOKEN } } }
  } as never
}

describe('serviceAppFetch atomically rewrites the target app context', () => {
  const globals = globalThis as { useRuntimeConfig?: unknown }
  const originalRuntimeConfig = globals.useRuntimeConfig

  test('all three target context headers name the target app, never the source', async () => {
    globals.useRuntimeConfig = () => ({})
    try {
      const captured: { headers?: Record<string, string> } = {}
      const event = bindingEvent(sourceContextHeaders(), captured)
      await serviceAppFetch(event, 'finance', 'https://wiztek.huizhi.yun/finance/api/v1/finance/service/x', {
        method: 'POST',
        headers: {
          'x-hzy-deployment': 'C000001-altoc',
          'x-forwarded-prefix': '/altoc'
        },
        body: {}
      })

      assert.ok(captured.headers, 'binding fetch must have been called')
      // CLAUDE.md 要求三字段同时断言：
      assert.equal(captured.headers['x-hzy-app-code'], 'finance')
      assert.equal(captured.headers['x-hzy-deployment'], 'C000001-finance')
      assert.equal(captured.headers['x-forwarded-prefix'], '/finance')
    } finally {
      globals.useRuntimeConfig = originalRuntimeConfig
    }
  })

  test('strips all three target context headers when the trusted route catalog is unavailable', async () => {
    globals.useRuntimeConfig = () => ({})
    try {
      const captured: { headers?: Record<string, string> } = {}
      // 无 service-routes 目录：三字段必须剥除，绝不能带着来源应用的上下文冒充
      const headers = sourceContextHeaders()
      delete (headers as Record<string, string>)['x-hzy-service-routes']
      const event = bindingEvent(headers, captured)
      await serviceAppFetch(event, 'finance', 'https://wiztek.huizhi.yun/finance/api/v1/x', {
        method: 'POST',
        headers: { 'x-hzy-deployment': 'C000001-altoc', 'x-hzy-app-code': 'altoc', 'x-forwarded-prefix': '/altoc' },
        body: {}
      })

      assert.ok(captured.headers)
      assert.ok(!('x-hzy-app-code' in captured.headers), 'source app-code must not leak')
      assert.ok(!('x-hzy-deployment' in captured.headers), 'source deployment must not leak')
      assert.ok(!('x-forwarded-prefix' in captured.headers), 'source prefix must not leak')
    } finally {
      globals.useRuntimeConfig = originalRuntimeConfig
    }
  })

  test('rejects a catalog that lacks the target app instead of inventing a context', async () => {
    globals.useRuntimeConfig = () => ({})
    try {
      const captured: { headers?: Record<string, string> } = {}
      const headers = sourceContextHeaders({
        'x-hzy-service-routes': JSON.stringify({ aims: { origin: 'https://aims.huizhi.yun', deploymentCode: 'C000001-aims', basePath: '/aims/' } })
      })
      const event = bindingEvent(headers, captured)
      await serviceAppFetch(event, 'finance', 'https://wiztek.huizhi.yun/finance/api/v1/x', { method: 'POST', body: {} })

      assert.ok(captured.headers)
      assert.ok(!('x-hzy-app-code' in captured.headers))
      assert.ok(!('x-hzy-deployment' in captured.headers))
    } finally {
      globals.useRuntimeConfig = originalRuntimeConfig
    }
  })
})
