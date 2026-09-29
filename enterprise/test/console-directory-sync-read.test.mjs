import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

const cases = [
  { path: '/enterprise/api/directory/sync-jobs', file: 'index', id: 'directory.sync-jobs.list', valid: '?limit=30', invalid: ['?limit=0', '?limit=101', '?limit=01', '?limit=2e1', '?limit=2&limit=3', '?uid=other'] },
  { path: '/enterprise/api/directory/sync-jobs/:jobCode', file: '[jobCode]', id: 'directory.sync-jobs.read', param: 'jobCode', valid: '/J1', invalid: ['/..', '/bad%20id', '/'+ 'A'.repeat(129), '/J1?limit=30', '/J1?uid=other'] },
  { path: '/enterprise/api/directory/sync-jobs/:jobCode/events', file: '[jobCode]/events', id: 'directory.sync-jobs.events.list', param: 'jobCode', valid: '/J1/events?limit=100', invalid: ['/bad%20id/events', '/J1/events?limit=101', '/J1/events?limit=1&limit=2', '/J1/events?include=secrets'] }
]
test('Console sync BFFs validate exact reads and preserve upstream statuses', async () => {
  const state = { seen: [], status: 0, row: { jobCode: 'J1', objectCode: 'U1', status: 'failed', providerCode: 'ldap', errorMessage: 'Platform subject projection failed: SECRET https://private.test/token', message: 'LDAP connector result is missing uid or dn SECRET', cursorAfter: 'SECRET', externalRef: 'SECRET', beforeHash: 'SECRET', futureField: { secret: 'SECRET' } } }
  globalThis.__syncReadTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/shared/utils/consoleSyncReadQuery') return { shortCircuit: true, url: new URL('../../foundation/shared/utils/consoleSyncReadQuery.ts', import.meta.url).href }
    if (specifier === './optionalReadPagination') return { shortCircuit: true, url: new URL('../../foundation/shared/utils/optionalReadPagination.ts', import.meta.url).href }
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__syncReadTest;s.seen.push({id,options});if(s.status)throw Object.assign(Error("SECRET https://private.test/token"),{statusCode:s.status});return id==="directory.sync-jobs.read"?s.row:(options.query.page||options.query.pageSize?{items:[s.row],total:21,page:Number(options.query.page||1),pageSize:Number(options.query.pageSize||20),secret:"SECRET"}:[s.row])}')}` }
    if (specifier.endsWith('/utils/consoleDirectorySyncRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const { syncFailureCategory, projectSyncJob, projectSyncEvent, projectSyncResult } = await import('../server/utils/consoleDirectorySyncRead.ts')
    for (const prefix of ['Directory data updated, but Platform subject sync failed: ', 'Platform subject projection failed: ', 'Platform subject sync returned HTTP ', 'Platform subject sync response is invalid', 'Platform projection chunk ']) assert.equal(syncFailureCategory(prefix + 'SECRET', 'failed'), 'Platform同步失败')
    for (const prefix of ['LDAP connector result is missing uid or dn', 'Connector Runtime DingTalk Directory sync failed']) assert.equal(syncFailureCategory(prefix + 'SECRET', 'failed'), '连接器同步失败')
    assert.equal(syncFailureCategory('SECRET unknown https://private.test', 'failed'), '同步失败')
    assert.equal(syncFailureCategory('Platform subject projection failed: SECRET', 'success'), null)
    const malformed = { ...state.row, objectCode: 'https://secret.test', startedAt: 'SECRET', providerCode: 'SECRET', totalCount: 'SECRET' }
    const projected = JSON.stringify([projectSyncJob(malformed), projectSyncEvent(malformed)])
    assert.doesNotMatch(projected, /SECRET|secret\.test/)
    for (const malformed of [{ items: [], total: -1, page: 2, pageSize: 20 }, { items: [], total: 21, page: 1, pageSize: 20 }, { items: [], total: 21, page: 2, pageSize: 101 }]) assert.throws(() => projectSyncResult(malformed, 'jobs', { page: '2', pageSize: '20' }))
    const router = createRouter()
    for (const item of cases) router.get(item.path, (await import(`../server/routes/enterprise/api/directory/sync-jobs/${item.file}.get.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
    for (const item of cases) {
      const base = item.param ? item.path.slice(0, item.path.indexOf(`/:${item.param}`)) : item.path
      const response = await request(base + item.valid)
      assert.equal(response.status, 200, item.id)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      const body = JSON.stringify(await response.json())
      assert.doesNotMatch(body, /SECRET|private\.test|errorMessage|\"message\"|cursorAfter|externalRef|beforeHash|futureField/)
      assert.match(body, /failureCategory/)
      assert.equal(state.seen.at(-1).id, item.id)
      if (item.param) assert.equal(state.seen.at(-1).options.params[item.param], 'J1')
      else if (item.valid) assert.equal(state.seen.at(-1).options.query.limit, '30')
      else assert.deepEqual(state.seen.at(-1).options.query, {})
      const count = state.seen.length
      for (const invalid of item.invalid) assert.ok([400, 404].includes((await request(base + invalid)).status), item.id + invalid)
      assert.equal(state.seen.length, count, 'invalid requests must not reach Console')
      for (const status of [401, 403, 503]) {
        state.status = status
        const failed = await request(base + item.valid)
        assert.equal(failed.status, status)
        assert.doesNotMatch(await failed.text(), /SECRET|private\.test/)
      }
      state.status = 0
      if (item.id !== 'directory.sync-jobs.read') {
        const pagedPath = item.id === 'directory.sync-jobs.list' ? base : `${base}/J1/events`
        const paged = await request(`${pagedPath}?page=2&pageSize=20`)
        assert.equal(paged.status, 200)
        const payload = await paged.json()
        assert.equal(payload.data.total, 21)
        assert.equal(payload.data.page, 2)
        assert.equal(payload.data.items.length, 1)
        assert.doesNotMatch(JSON.stringify(payload), /SECRET|errorMessage|"message"|externalRef|beforeHash|secret/)
        const calls = state.seen.length
        for (const invalid of ['page=0', 'page=01', 'page=1.2', 'pageSize=101', 'page=', 'page=1&page=2', 'page=1&limit=20']) assert.equal((await request(`${pagedPath}?${invalid}`)).status, 400)
        assert.equal(state.seen.length, calls)
      }
      assert.equal(isBusinessApiReady('GET', item.path), true)
      assert.equal(isBusinessApiReady('POST', item.path), false)
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__syncReadTest
  }
})
