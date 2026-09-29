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
  assert.equal(matchConsoleUserApiRoute('GET', '/api/v1/console/profile')?.id, 'org-profile.read')
  assert.equal(matchConsoleUserApiRoute('get', '/api/v1/console/notifications/todos')?.id, 'notifications.todos.list')
  assert.equal(matchConsoleUserApiRoute('PUT', '/api/v1/console/profile'), null)
  assert.equal(matchConsoleUserApiRoute('GET', '/api/v1/console/profile/extra'), null)
  assert.equal(matchConsoleUserApiRoute('GET', '/api/v1/console/vault'), null)
  for (const route of consoleUserApiRoutes) {
    assert.ok(Object.isFrozen(route) && Object.isFrozen(route.query), `${route.id} must be frozen`)
    const companyReads = {
      'organization.business-domains.list': '/api/v1/companies/:companyCode/business-domains',
      'organization.regions.list': '/api/v1/companies/:companyCode/regions',
      'organization.regions.divisions.list': '/api/v1/companies/:companyCode/regions/:regionCode/divisions'
    } as Record<string, string>
    if (Object.hasOwn(companyReads, route.id)) {
      assert.equal(route.path, companyReads[route.id])
      assert.equal(route.method, 'GET')
      assert.equal(route.write, false)
      assert.deepEqual(route.query, [])
    } else {
      assert.ok(route.path.startsWith('/api/v1/console/'), `${route.id} must stay inside the Console user API`)
    }
  }
  assert.throws(() => resolveConsoleUserApiRoute('unknown'), /Unregistered/)
  assert.throws(() => resolveConsoleUserApiRoute('org-profile.read', { extra: 'x' }), /Unexpected/)
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
  await assert.rejects(fetchConsoleUserApi(event(), 'org-profile.read'), error => statusOf(error) === 401)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: { ...user, tokenUse: 'service', subjectType: 'service' } }), 'org-profile.read'), error => statusOf(error) === 401)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'org-profile.read', { query: { include: 'secrets' } }), error => statusOf(error) === 400)
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'not-registered'), error => statusOf(error) === 400)
  assert.equal(calls.length, 0)
})

test('passes Console permission and availability failures through; other failures become 502', async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    reply = () => Response.json({ message: `console ${status}` }, { status })
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'org-profile.read'), error => statusOf(error) === status)
  }
  reply = () => Response.json({ message: 'boom' }, { status: 500 })
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'org-profile.read'), error => statusOf(error) === 502)
  reply = () => Response.json({ code: 40001, message: 'business error' })
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'org-profile.read'), error => statusOf(error) === 502)
})

test('org-profile registered read forwards the user and cannot reach neighbouring writes', async () => {
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'org-profile.read')
  assert.equal(new URL(calls[0]!.url).pathname, '/api/v1/console/profile')
  assert.equal(calls[0]!.method, 'GET')
  assert.equal(calls[0]!.headers.Authorization, 'Bearer user-access-token')
  for (const path of ['/api/v1/console/profile/edit', '/api/v1/console/profile/credentials']) {
    assert.equal(matchConsoleUserApiRoute('GET', path), null)
  }
  assert.equal(matchConsoleUserApiRoute('PATCH', '/api/v1/console/profile'), null)
})

test('directory users registry allows exact list and user reads, never adjacent administration', async () => {
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.users.list', { query: { page: 2, pageSize: 20, search: '员工', deptCode: 'D1', status: 'all' } })
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.users.read', { params: { uid: 'U1' } })
  assert.equal(new URL(calls[1]!.url).pathname, '/api/v1/console/directory/users/U1')
  assert.equal(calls[1]!.headers.Authorization, 'Bearer user-access-token')
  for (const path of ['/api/v1/console/directory/users/U1/password', '/api/v1/console/directory/provisioning', '/api/v1/console/directory/operations/O1']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/users/U1'), null)
  assert.throws(() => resolveConsoleUserApiRoute('directory.users.read', { uid: '..' }))
  await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.users.read', { params: { uid: 'U1' }, query: { include: 'secrets' } }), error => statusOf(error) === 400)
})

test('departments registry permits only list and safe department reads', async () => {
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.departments.list')
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.departments.read', { params: { deptCode: 'D1' } })
  assert.equal(new URL(calls[1]!.url).pathname, '/api/v1/console/directory/departments/D1')
  for (const path of ['/api/v1/console/directory/departments/D1/members', '/api/v1/console/directory/departments/..']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
  assert.equal(matchConsoleUserApiRoute('PATCH', '/api/v1/console/directory/departments/D1')?.id, 'directory.departments.update')
})

test('projects registry allows list, detail and member reads and rejects unregistered methods', async () => {
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.projects.list', { query: { page: 2, leaderUid: 'U1' } })
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.projects.read', { params: { projectCode: 'P1' } })
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.projects.members.list', { query: { projectCode: 'P1', page: 2 } })
  assert.equal(new URL(calls[1]!.url).pathname, '/api/v1/console/directory/projects/P1')
  assert.equal(new URL(calls[2]!.url).pathname, '/api/v1/console/directory/projects/members')
  assert.equal(calls[2]!.headers.Authorization, 'Bearer user-access-token')
  assert.equal(matchConsoleUserApiRoute('GET', '/api/v1/console/directory/projects/members')?.id, 'directory.projects.members.list')
  for (const path of ['/api/v1/console/directory/projects/P1/members', '/api/v1/console/directory/projects/..']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
  for (const method of ['POST', 'PUT']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/projects/P1'), null)
})

test('committee registry permits only list and member reads under the user identity', async () => {
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.committees.list', { query: { page: 2, status: 'all' } })
  await fetchConsoleUserApi(event({ consoleAuth: user }), 'directory.committees.members.list', { params: { committeeCode: 'C1' }, query: { page: 2, role: 'leader' } })
  assert.equal(new URL(calls[1]!.url).pathname, '/api/v1/console/directory/committees/C1/members')
  assert.equal(calls[1]!.headers.Authorization, 'Bearer user-access-token')
  for (const path of ['/api/v1/console/directory/committees/C1', '/api/v1/console/directory/committees/C1/members/U1', '/api/v1/console/directory/committees/../members']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/committees/C1/members'), null)
})


test('calendar registry exposes exactly three GET reads without import or daily writes', async () => {
  for (const [id, params, query, path] of [
    ['work-calendars.list', {}, {}, '/api/v1/console/work-calendars'],
    ['work-calendars.months.list', { calendarCode: 'CN' }, { year: 2026 }, '/api/v1/console/work-calendars/CN/months'],
    ['work-calendars.days.list', { calendarCode: 'CN' }, { yearMonth: '2026-09' }, '/api/v1/console/work-calendars/CN/days']
  ] as const) {
    await fetchConsoleUserApi(event({ consoleAuth: user }), id, { params, query })
    assert.equal(new URL(calls.at(-1)!.url).pathname, path)
    assert.equal(calls.at(-1)!.headers.Authorization, 'Bearer user-access-token')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, path), null)
  }
  for (const path of ['/api/v1/console/work-calendars/CN/import-year', '/api/v1/console/work-calendars/CN/days/2026-09-01', '/api/v1/console/work-calendars/../months']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
})


test('sync registry exposes only list, detail and event GETs', async () => {
  for (const [id, params, query, path] of [
    ['directory.sync-jobs.list', {}, { limit: 30 }, '/api/v1/console/directory/sync-jobs'],
    ['directory.sync-jobs.read', { jobCode: 'J1' }, {}, '/api/v1/console/directory/sync-jobs/J1'],
    ['directory.sync-jobs.events.list', { jobCode: 'J1' }, { limit: 100 }, '/api/v1/console/directory/sync-jobs/J1/events'],
    ['directory.sync-jobs.list', {}, { page: 2, pageSize: 20 }, '/api/v1/console/directory/sync-jobs'],
    ['directory.sync-jobs.events.list', { jobCode: 'J1' }, { page: 2, pageSize: 20 }, '/api/v1/console/directory/sync-jobs/J1/events']
  ] as const) {
    await fetchConsoleUserApi(event({ consoleAuth: user }), id, { params, query })
    assert.equal(new URL(calls.at(-1)!.url).pathname, path)
    assert.equal(calls.at(-1)!.headers.Authorization, 'Bearer user-access-token')
    for (const [key, value] of Object.entries(query)) assert.equal(new URL(calls.at(-1)!.url).searchParams.get(key), String(value))
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, path), null)
  }
  for (const path of ['/api/v1/console/directory/sync-jobs/J1/retry', '/api/v1/console/directory/sync-jobs/J1/events/1', '/api/v1/console/directory/sources', '/api/v1/console/directory/sync-jobs/../events']) assert.equal(matchConsoleUserApiRoute('GET', path), null)
})


test('departments writes require and forward the browser key and verified user only', async () => {
  for (const [id, method, params, path] of [
    ['directory.departments.create', 'POST', {}, '/api/v1/console/directory/departments'],
    ['directory.departments.update', 'PATCH', { deptCode: 'D1' }, '/api/v1/console/directory/departments/D1'],
    ['directory.departments.delete', 'DELETE', { deptCode: 'D1' }, '/api/v1/console/directory/departments/D1']
  ] as const) {
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), id, { params }), error => statusOf(error) === 400)
    const key = 'directory:department:test-0001'
    await fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key, 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer forged' } }), id, { params, body: { name: '部门' } })
    const call = calls.at(-1)!
    assert.equal(call.method, method)
    assert.equal(new URL(call.url).pathname, path)
    assert.equal(call.headers.Authorization, 'Bearer user-access-token')
    assert.equal(call.headers['idempotency-key'], key)
    assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    reply = () => Response.json({ message: 'denied' }, { status: 403 })
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key } }), id, { params }), error => statusOf(error) === 403)
    reply = () => Response.json({ code: 0, data: { ok: true } })
  }
  for (const method of ['PUT', 'POST']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/departments/D1'), null)
  for (const path of ['/api/v1/console/directory/departments/D1/members', '/api/v1/console/directory/departments/D1/children']) assert.equal(matchConsoleUserApiRoute('POST', path), null)
})

test('projects writes require and forward the browser key and verified user only', async () => {
  for (const [id, method, params, path] of [
    ['directory.projects.create', 'POST', {}, '/api/v1/console/directory/projects'],
    ['directory.projects.update', 'PATCH', { projectCode: 'P1' }, '/api/v1/console/directory/projects/P1'],
    ['directory.projects.delete', 'DELETE', { projectCode: 'P1' }, '/api/v1/console/directory/projects/P1'],
    ['directory.projects.members.replace', 'POST', {}, '/api/v1/console/directory/projects/members']
  ] as const) {
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), id, { params }), error => statusOf(error) === 400)
    const key = 'directory:project:test-0001'
    await fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key, 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer forged' } }), id, { params, body: { name: '部门' } })
    const call = calls.at(-1)!
    assert.equal(call.method, method)
    assert.equal(new URL(call.url).pathname, path)
    assert.equal(call.headers.Authorization, 'Bearer user-access-token')
    assert.equal(call.headers['idempotency-key'], key)
    assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    reply = () => Response.json({ message: 'denied' }, { status: 403 })
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key } }), id, { params }), error => statusOf(error) === 403)
    reply = () => Response.json({ code: 0, data: { ok: true } })
  }
  for (const method of ['PUT', 'POST']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/projects/P1'), null)
  for (const method of ['PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/projects/members'), null)
  assert.throws(() => resolveConsoleUserApiRoute('directory.projects.update', { projectCode: 'members' }), /Invalid/)
  for (const path of ['/api/v1/console/directory/projects/P1/members', '/api/v1/console/directory/projects/P1/children']) assert.equal(matchConsoleUserApiRoute('POST', path), null)
})

test('committees writes require and forward the browser key and verified user only', async () => {
  for (const [id, method, params, path] of [
    ['directory.committees.create', 'POST', {}, '/api/v1/console/directory/committees'],
    ['directory.committees.update', 'PATCH', { committeeCode: 'C1' }, '/api/v1/console/directory/committees/C1'],
    ['directory.committees.delete', 'DELETE', { committeeCode: 'C1' }, '/api/v1/console/directory/committees/C1'],
    ['directory.committees.members.save', 'POST', { committeeCode: 'C1' }, '/api/v1/console/directory/committees/C1/members'],
    ['directory.committees.members.update', 'PATCH', { committeeCode: 'C1', uid: 'U1' }, '/api/v1/console/directory/committees/C1/members/U1'],
    ['directory.committees.members.remove', 'DELETE', { committeeCode: 'C1', uid: 'U1' }, '/api/v1/console/directory/committees/C1/members/U1']
  ] as const) {
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), id, { params }), error => statusOf(error) === 400)
    const key = 'directory:committee:test-0001'
    await fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key, 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer forged' } }), id, { params, body: { name: '部门' } })
    const call = calls.at(-1)!
    assert.equal(call.method, method)
    assert.equal(new URL(call.url).pathname, path)
    assert.equal(call.headers.Authorization, 'Bearer user-access-token')
    assert.equal(call.headers['idempotency-key'], key)
    assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    reply = () => Response.json({ message: 'denied' }, { status: 403 })
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'idempotency-key': key } }), id, { params }), error => statusOf(error) === 403)
    reply = () => Response.json({ code: 0, data: { ok: true } })
  }
  for (const method of ['PUT', 'POST']) assert.equal(matchConsoleUserApiRoute(method, '/api/v1/console/directory/committees/C1'), null)
  for (const path of ['/api/v1/console/directory/committees/C1/members/U1/role', '/api/v1/console/directory/committees/C1/children']) assert.equal(matchConsoleUserApiRoute('POST', path), null)
})

test('C1 company reads forward only verified user credentials through exact legacy Console paths', async () => {
  for (const id of ['organization.business-domains.list', 'organization.regions.list', 'organization.regions.divisions.list']) {
    const params = { companyCode: 'C1', ...(id.includes('divisions') ? { regionCode: 'R1' } : {}) }
    await fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer forged' } }), id, { params })
    const call = calls.at(-1)!
    assert.equal(call.method, 'GET')
    assert.equal(call.headers.Authorization, 'Bearer user-access-token')
    assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    assert.equal(call.body, undefined)
    assert.ok(new URL(call.url).pathname.startsWith('/api/v1/companies/C1/'))
    await assert.rejects(fetchConsoleUserApi(event(), id, { params }), error => statusOf(error) === 401)
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: { ...user, tokenUse: 'service', subjectType: 'service' } }), id, { params }), error => statusOf(error) === 401)
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), id, { params, query: { companyCode: 'other' } }), error => statusOf(error) === 400)
  }
})

test('C2 summaries use verified user reads and cannot reach operation or configuration endpoints', async () => {
  for (const id of ['runtime-summary.data.read', 'runtime-summary.applications.read']) {
    await fetchConsoleUserApi(event({ consoleAuth: user, headers: { 'x-hzy-actor-uid': 'forged', 'authorization': 'Bearer forged' } }), id)
    const call = calls.at(-1)!
    assert.equal(call.method, 'GET')
    assert.equal(call.headers.Authorization, 'Bearer user-access-token')
    assert.equal(call.headers['x-hzy-actor-uid'], undefined)
    assert.equal(call.body, undefined)
    await assert.rejects(fetchConsoleUserApi(event(), id), error => statusOf(error) === 401)
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: { ...user, tokenUse: 'service', subjectType: 'service' } }), id), error => statusOf(error) === 401)
    await assert.rejects(fetchConsoleUserApi(event({ consoleAuth: user }), id, { query: { include: 'config' } }), error => statusOf(error) === 400)
  }
  for (const path of ['/api/v1/console/data-runtime/update', '/api/v1/console/runtime/apps/aims/action', '/api/v1/console/runtime/apps/aims/config']) {
    for (const method of ['GET', 'POST']) assert.equal(matchConsoleUserApiRoute(method, path), null)
  }
})
