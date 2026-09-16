import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { afterEach, test } from 'node:test'
import { $fetch } from 'ofetch'
import {
  resolveConsoleAuthWithSessionBridge,
  resolveConsoleSessionBridge,
  fetchConsoleSessionApi
} from '../server/utils/consoleSessionBridge.ts'

const originalRuntimeConfig = (globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig
const originalFetch = (globalThis as { $fetch?: unknown }).$fetch

afterEach(() => {
  ;(globalThis as { useRuntimeConfig?: unknown }).useRuntimeConfig = originalRuntimeConfig
  ;(globalThis as { $fetch?: unknown }).$fetch = originalFetch
})

test('memoizes the Console auth/me promise only inside one H3 event', async () => {
  ;(globalThis as { $fetch?: unknown }).$fetch = $fetch
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      code: 0,
      data: {
        authenticated: true,
        subject: { uid: 'u-request-memo', subjectCode: 'u-request-memo' }
      }
    }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const consoleUrl = `http://127.0.0.1:${address.port}`
    ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
      public: { appCode: 'aims', consoleUrl },
      hzy: { appCode: 'aims' }
    })

    const createEvent = () => ({
      context: {},
      node: {
        req: {
          headers: { cookie: 'console_session=session-cookie', host: 'aims.example.test' },
          url: '/api/test',
          originalUrl: '/api/test'
        }
      },
      path: '/api/test'
    }) as never

    const firstEvent = createEvent()
    const first = resolveConsoleSessionBridge(firstEvent)
    const second = resolveConsoleSessionBridge(firstEvent)
    assert.equal(first, second)
    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult?.uid, 'u-request-memo')
    assert.equal(secondResult?.uid, 'u-request-memo')
    assert.equal(requestCount, 1)

    await resolveConsoleSessionBridge(createEvent())
    assert.equal(requestCount, 2, 'a separate request must not reuse another request session result')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('reuses an authenticated request context populated by server middleware', async () => {
  const consoleAuth = {
    authenticated: true,
    tokenUse: 'console_session',
    subjectType: 'user',
    uid: 'u-console-session',
    subjectCode: 'u-console-session'
  } as const
  const event = {
    context: { consoleAuth }
  } as never

  assert.equal(await resolveConsoleAuthWithSessionBridge(event), consoleAuth)
})

test('session API uses Binding, retains query and cookie, and preserves failure status', async () => {
  ;(globalThis as { useRuntimeConfig?: () => unknown }).useRuntimeConfig = () => ({
    public: { appCode: 'people', consoleUrl: 'https://tenant.test' },
    hzy: { appCode: 'people' }
  })
  let status = 200
  const event = {
    context: { cloudflare: { env: { HZY_CONSOLE_SERVICE: {
      async fetch(url: string, init: RequestInit) {
        assert.equal(new URL(url).searchParams.get('page'), '2')
        assert.equal(new Headers(init.headers).get('cookie'), 'console_session=test')
        return Response.json({ code: 0 }, { status })
      }
    } } } },
    path: '/api/test',
    node: { req: { headers: { host: 'tenant.test', cookie: 'console_session=test' }, url: '/api/test', originalUrl: '/api/test' } }
  } as never
  assert.deepEqual(await fetchConsoleSessionApi(event, '/api/user/applications', { query: { page: 2 } }), { code: 0 })
  for (const failure of [401, 403, 503]) {
    status = failure
    await assert.rejects(fetchConsoleSessionApi(event, '/api/user/applications', { query: { page: 2 } }),
      (error: { statusCode?: number }) => error.statusCode === failure)
  }
})
