import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

const cases = [
  { path: '/enterprise/api/work-calendars', file: 'index', id: 'work-calendars.list', valid: '', invalid: ['?year=2026', '?uid=other'] },
  { path: '/enterprise/api/work-calendars/:calendarCode/months', file: '[calendarCode]/months', id: 'work-calendars.months.list', param: 'calendarCode', valid: '/CN/months?year=2026', invalid: ['/CN/months', '/CN/months?year=1999', '/CN/months?year=2101', '/CN/months?year=2e3', '/CN/months?year=2026&year=2025', '/CN/months?year=2026&uid=other', '/lower/months?year=2026', '/'+ 'A'.repeat(65) + '/months?year=2026'] },
  { path: '/enterprise/api/work-calendars/:calendarCode/days', file: '[calendarCode]/days', id: 'work-calendars.days.list', param: 'calendarCode', valid: '/CN/days?yearMonth=2026-09', invalid: ['/CN/days', '/CN/days?yearMonth=2026-00', '/CN/days?yearMonth=2026-13', '/CN/days?yearMonth=1999-01', '/CN/days?yearMonth=2026-9', '/CN/days?yearMonth=2026-09&yearMonth=2026-10', '/bad%20code/days?yearMonth=2026-09'] }
]
test('Console work calendar BFFs validate exact reads and preserve upstream statuses', async () => {
  const state = { seen: [], status: 0 }
  globalThis.__calendarReadTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__calendarReadTest;s.seen.push({id,options});if(s.status)throw Object.assign(Error("Console"),{statusCode:s.status});return {items:[],total:0}}')}` }
    if (specifier.endsWith('/utils/consoleWorkCalendarRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    for (const item of cases) router.get(item.path, (await import(`../server/routes/enterprise/api/work-calendars/${item.file}.get.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
    for (const item of cases) {
      const base = item.param ? item.path.slice(0, item.path.indexOf(`/:${item.param}`)) : item.path
      const response = await request(base + item.valid)
      assert.equal(response.status, 200, item.id)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(state.seen.at(-1).id, item.id)
      if (item.param) assert.equal(state.seen.at(-1).options.params[item.param], 'CN')
      else if (item.valid) assert.equal(state.seen.at(-1).options.query.page, '2')
      else assert.deepEqual(state.seen.at(-1).options.query, {})
      const count = state.seen.length
      for (const invalid of item.invalid) assert.ok([400, 404].includes((await request(base + invalid)).status), item.id + invalid)
      assert.equal(state.seen.length, count, 'invalid requests must not reach Console')
      for (const status of [401, 403, 503]) {
        state.status = status
        assert.equal((await request(base + item.valid)).status, status)
      }
      state.status = 0
      assert.equal(isBusinessApiReady('GET', item.path), true)
      assert.equal(isBusinessApiReady('POST', item.path), false)
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__calendarReadTest
  }
})
