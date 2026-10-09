import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

// Real notification credential guard and proxy, with only the transport mocked.
// No live Console, Runtime or database is contacted.
test('Host todos validates a narrow query, forwards verified users and preserves upstream statuses', async () => {
  const previous = { config: globalThis.useRuntimeConfig, state: globalThis.__consoleTodosTest }
  const seen = []
  const state = { auth: { authenticated: true, subjectType: 'user', tokenUse: 'access', token: 'verified-user' }, upstreamStatus: 0, seen }
  globalThis.__consoleTodosTest = state
  globalThis.useRuntimeConfig = () => ({ public: {}, hzy: {} })
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/shared/utils/todoReadQuery')
      return { url: new URL('../../foundation/shared/utils/todoReadQuery.ts', import.meta.url).href, shortCircuit: true }
    if (specifier === './optionalReadPagination' && context.parentURL?.endsWith('/todoReadQuery.ts'))
      return { url: new URL('../../foundation/shared/utils/optionalReadPagination.ts', import.meta.url).href, shortCircuit: true }
    if (specifier === '@hzy/foundation/server/utils/notifications') {
      return { url: new URL('../../foundation/server/utils/notifications.ts', import.meta.url).href, shortCircuit: true }
    }
    if (context.parentURL?.endsWith('/foundation/server/utils/notifications.ts')) {
      const mocks = {
        './consoleRuntime': 'export const getConsoleRuntimeConfig=async()=>({console:{baseUrl:"https://console.example"}}); export const resolveConsoleRuntimeBaseUrl=()=>""',
        './serviceAppUrl': 'export const resolveServiceAppBaseUrl=()=>"https://console.example"',
        './serviceOidc': 'export const fetchConsoleServiceJson=()=>{}; export const requestServiceAccessToken=()=>{throw Error("no service token allowed")}; export const trustedServiceRequestHeaders=()=>({})',
        './consoleServiceBinding': `export const consoleServiceFetch=async(event,url,options)=>{
          const state=globalThis.__consoleTodosTest;
          state.seen.push({url,options});
          if(state.upstreamStatus) throw Object.assign(Error('Console failure'),{statusCode:state.upstreamStatus,unhandled:false});
          return {code:0,data:{items:[{notificationId:'n1'}],nextCursor:null}};
        }`
      }
      if (mocks[specifier])
        return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const handler = (await import('../server/routes/enterprise/api/notifications/todos.get.ts')).default
    const app = createApp()
    app.use(defineEventHandler((event) => {
      if (state.auth)
        event.context.consoleAuth = state.auth
    }))
    app.use(createRouter().get('/enterprise/api/notifications/todos', handler))
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = (query = '', headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/enterprise/api/notifications/todos${query}`, { headers })
    const response = await request('?todoKind=approval&cursor=cursor%2B1&limit=50', { 'authorization': 'Bearer attacker-header', 'x-hzy-actor-uid': 'attacker' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await response.json(), { code: 0, message: 'success', data: { items: [{ notificationId: 'n1' }], nextCursor: null } })
    assert.equal(seen[0].url, 'https://console.example/api/v1/console/notifications/todos')
    assert.deepEqual(seen[0].options.params, { todoKind: 'approval', cursor: 'cursor+1', limit: 50 })
    assert.equal(seen[0].options.headers.Authorization, 'Bearer verified-user')
    assert.equal(seen[0].options.headers['x-hzy-actor-uid'], undefined)
    assert.equal(seen[0].options.method, 'GET')
    assert.equal((await request('?page=2&pageSize=100&todoKind=risk')).status, 200)
    assert.deepEqual(seen.at(-1).options.params, { todoKind: 'risk', page: '2', pageSize: '100' })
    for (const query of ['?page=0', '?page=01', '?page=', '?pageSize=101', '?page=1&page=2', '?page=1&limit=20', '?page=1&cursor=']) {
      const before = seen.length
      assert.equal((await request(query)).status, 400, query)
      assert.equal(seen.length, before)
    }
    assert.equal((await request()).status, 200)
    assert.equal(seen.at(-1).options.params.limit, 20)
    for (const kind of ['approval', 'due', 'risk', 'follow_up'])
      assert.equal((await request(`?todoKind=${kind}&limit=1`)).status, 200)
    assert.equal((await request(`?cursor=${'a'.repeat(512)}`)).status, 200)
    assert.equal(seen.at(-1).options.params.cursor.length, 512)
    for (const query of [
      `?cursor=${'a'.repeat(513)}`,
      '?uid=other', '?tenant=t2', '?sourceAppCode=aims', '?category=any', '?todo_kind=approval',
      '?todoKind=all', '?todoKind=', '?todoKind=due&todoKind=risk', '?cursor=a&cursor=b',
      '?limit=0', '?limit=51', '?limit=-1', '?limit=1.5', '?limit=1e1', '?limit=', '?limit=NaN', '?limit=20&limit=20'
    ]) {
      const before = seen.length
      assert.equal((await request(query)).status, 400, query)
      assert.equal(seen.length, before, 'invalid query must never reach Console')
    }
    for (const auth of [
      null,
      { authenticated: false, subjectType: 'user', tokenUse: 'access', token: 'raw' },
      { authenticated: true, subjectType: 'service', tokenUse: 'service', token: 'service' },
      { authenticated: true, tokenUse: 'access', token: 'missing-subject-type' }
    ]) {
      state.auth = auth
      const before = seen.length
      assert.equal((await request('', { authorization: 'Bearer raw', cookie: 'hzy_access_token=raw' })).status, 401)
      assert.equal(seen.length, before)
    }
    state.auth = { authenticated: true, subjectType: 'user', tokenUse: 'access', token: 'verified-user' }
    for (const status of [401, 403, 503]) {
      state.upstreamStatus = status
      assert.equal((await request()).status, status)
    }
    assert.equal(isBusinessApiReady('GET', '/enterprise/api/notifications/todos'), true)
    assert.equal(isBusinessApiReady('POST', '/enterprise/api/notifications/todos'), false)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    hooks.deregister()
    if (previous.config === undefined)
      delete globalThis.useRuntimeConfig
    else
      globalThis.useRuntimeConfig = previous.config
    if (previous.state === undefined)
      delete globalThis.__consoleTodosTest
    else
      globalThis.__consoleTodosTest = previous.state
  }
})
