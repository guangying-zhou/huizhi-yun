import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { H3Event } from 'h3'
import { consoleUserApiRoutes, matchConsoleUserApiRoute, resolveConsoleUserApiRoute } from '../shared/utils/consoleUserApiRoutes.ts'
import { fetchConsoleUserApi } from '../server/utils/consoleUserApi.ts'

interface Call { url: string, method: string, headers: Record<string, string>, body?: string }

const globals = globalThis as typeof globalThis & { useRuntimeConfig?: () => unknown }
const originalRuntimeConfig = globals.useRuntimeConfig
const originalLocal = process.env.HZY0_LOCAL_ENTERPRISE
let calls: Call[] = []
let reply: () => Response = () => Response.json({ code: 0, data: { ok: true } })

function event(input: { headers?: Record<string, string>, consoleAuth?: Record<string, unknown> } = {}) {
  return {
    context: {
      ...(input.consoleAuth ? { consoleAuth: input.consoleAuth } : {}),
      hzyConsoleTransport: {
        fetch: async (url: string, init: { method: string, headers: Record<string, string>, body?: string }) => {
          calls.push({ url, method: init.method, headers: init.headers, body: init.body })
          return reply()
        }
      }
    },
    node: { req: { headers: input.headers || {} } }
  } as unknown as H3Event
}

const user = { authenticated: true, subjectType: 'user', tokenUse: 'access', token: 'user-access-token' }

function statusOf(error: unknown) {
  return Number((error as { statusCode?: number })?.statusCode || 0)
}

beforeEach(() => {
  calls = []
  reply = () => Response.json({ code: 0, data: { ok: true } })
  process.env.HZY0_LOCAL_ENTERPRISE = 'true'
  globals.useRuntimeConfig = () => ({ hzy: { consoleApiUrl: 'https://console.example.test' } })
})

afterEach(() => {
  globals.useRuntimeConfig = originalRuntimeConfig
  if (originalLocal === undefined) delete process.env.HZY0_LOCAL_ENTERPRISE
  else process.env.HZY0_LOCAL_ENTERPRISE = originalLocal
})

test('registry matches only exact registered METHOD + path', () => {
  assert.equal(matchConsoleUserApiRoute('get', '/api/v1/console/notifications/todos')?.id, 'notifications.todos.list')
  assert.equal(matchConsoleUserApiRoute('POST', '/api/v1/console/notifications/todos'), null)
  assert.equal(matchConsoleUserApiRoute('GET', '/api/v1/console/notifications/todos/extra'), null)
  // Console administration is no longer composed into the Host (ADR-018a D8): none of its user APIs is registered.
  for (const path of ['/api/v1/console/profile', '/api/v1/console/directory/users', '/api/v1/console/work-calendars', '/api/v1/console/vault']) {
    assert.equal(matchConsoleUserApiRoute('GET', path), null)
  }
  assert.deepEqual(consoleUserApiRoutes.map(route => route.id), ['notifications.todos.list'])
  for (const route of consoleUserApiRoutes) {
    assert.ok(Object.isFrozen(route) && Object.isFrozen(route.query), `${route.id} must be frozen`)
    assert.ok(route.path.startsWith('/api/v1/console/'), `${route.id} must stay inside the Console user API`)
  }
  assert.throws(() => resolveConsoleUserApiRoute('unknown'), /Unregistered/)
  assert.throws(() => resolveConsoleUserApiRoute('notifications.todos.list', { extra: 'x' }), /Unexpected/)
})

test('forwards only the verified user credential to the registered path', async () => {
  const data = await fetchConsoleUserApi(event({
    consoleAuth: user,
    headers: { 'cookie': 'hzy_session=should-not-forward', 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer caller-supplied' }
  }), 'notifications.todos.list', { query: { todoKind: 'approval', limit: 20 } })
  assert.deepEqual(data, { ok: true })
  assert.equal(calls.length, 1)
  const url = new URL(calls[0]!.url)
  assert.equal(url.pathname, '/api/v1/console/notifications/todos')
  assert.equal(url.searchParams.get('todoKind'), 'approval')
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(calls[0]!.headers.Authorization, 'Bearer user-access-token')
  assert.equal(calls[0]!.headers.cookie, undefined)
  assert.equal(calls[0]!.headers['x-hzy-actor-uid'], undefined)
  assert.equal(calls[0]!.body, undefined)
})

test('rejects missing user credentials, service tokens and unknown query keys before calling Console', async () => {
  await assert.rejects(fetchConsoleUserApi(event(), 'notifications.todos.list'), error => statusOf(error) === 401)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: { ...user, tokenUse: 'service', subjectType: 'service' } }), 'notifications.todos.list'), error => statusOf(error) === 401)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'notifications.todos.list', { query: { include: 'secrets' } }), error => statusOf(error) === 400)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'not-registered'), error => statusOf(error) === 400)
  assert.equal(calls.length, 0)
})

test('passes Console permission and availability failures through; other failures become 502', async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    reply = () => Response.json({ message: `console ${status}` }, { status })
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'notifications.todos.list'), error => statusOf(error) === status)
  }
  reply = () => Response.json({ message: 'boom' }, { status: 500 })
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'notifications.todos.list'), error => statusOf(error) === 502)
  reply = () => Response.json({ code: 40001, message: 'business error' })
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'notifications.todos.list'), error => statusOf(error) === 502)
})
