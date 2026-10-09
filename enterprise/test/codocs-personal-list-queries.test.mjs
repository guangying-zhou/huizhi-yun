import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, toNodeListener } from 'h3'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

// The Codocs document index caps a paged read at pageSize=100 (a larger value is
// a 400), so calendar lists must page instead of asking for 200 rows at once.
test('worklog and weekly-report lists page at most 100 rows and derive the owner from the session', async () => {
  const calls = []
  let rowsPerCall = () => []
  let totalFor = items => items.length
  globalThis.__codocsListCall = async (_event, operation, input) => {
    calls.push({ operation, input })
    const items = rowsPerCall(input.query)
    return { success: true, data: { items, total: totalFor(items, input.query) } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=(...args)=>globalThis.__codocsListCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{documents:["view","create"]}})', shortCircuit: true }
    if (specifier === './enterpriseCodocsDocumentCreation') return { url: 'data:text/javascript,export const createEnterpriseCodocsDocument=async()=>({})', shortCircuit: true }
    if (specifier.startsWith('@hzy/foundation/')) {
      const candidate = resolve(import.meta.dirname, '../../foundation', specifier.slice('@hzy/foundation/'.length))
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseCodocsWorklogsList } = await import('../server/utils/enterpriseCodocsWorklogs.ts')
    const { enterpriseCodocsPersonalWeeklyReportsList } = await import('../server/utils/enterpriseCodocsPersonalWeeklyReports.ts')
    const app = createApp()
    const router = createRouter()
    router.get('/worklogs/list', enterpriseCodocsWorklogsList)
    router.get('/personal-weekly-reports/list', enterpriseCodocsPersonalWeeklyReportsList)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const get = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)

    // journal.vue: year + month only.
    const response = await get('/worklogs/list?year=2026&month=9')
    assert.equal(response.status, 200)
    assert.equal(calls.length, 3)
    for (const call of calls) {
      assert.equal(call.operation, 'codocs.personal-document-list')
      assert.equal(call.input.query.pageSize, '100')
      assert.equal(call.input.query.page, '1')
      assert.equal(call.input.authorization.actorUid, 'U1')
      assert.equal('owner' in call.input.query, false)
    }

    // A full page continues to the next page; a short page ends the read.
    calls.length = 0
    rowsPerCall = query => query.type === 'worklog' && query.page === '1'
      ? Array.from({ length: 100 }, (_, i) => ({ uuid: `w-${i}`, title: `202609${String((i % 28) + 1).padStart(2, '0')}-工作日志` }))
      : []
    totalFor = (_items, query) => query.type === 'worklog' ? 100 + 5 : 0
    const paged = await get('/worklogs/list?year=2026&month=9')
    assert.equal(paged.status, 200)
    assert.deepEqual(calls.filter(call => call.input.query.type === 'worklog').map(call => call.input.query.page), ['1', '2'])
    rowsPerCall = () => []
    totalFor = items => items.length

    // Weekly reports: no owner, or the caller's own uid; never another user.
    calls.length = 0
    assert.equal((await get('/personal-weekly-reports/list?year=2026')).status, 200)
    assert.deepEqual(calls.map(call => [call.input.query.type, call.input.query.pageSize]), [['private', '100'], ['weekly-report', '100']])
    assert.equal((await get('/personal-weekly-reports/list?year=2026&owner=U1')).status, 200)
    const before = calls.length
    assert.equal((await get('/personal-weekly-reports/list?year=2026&owner=U2')).status, 403)
    assert.equal((await get('/personal-weekly-reports/list?year=2026&limit=500')).status, 400)
    assert.equal((await get('/worklogs/list?year=2026&month=9&owner=U1')).status, 400)
    assert.equal(calls.length, before, 'rejected requests must not reach Runtime')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__codocsListCall
  }
})

test('composed Codocs list pages send no identity filter or legacy limit to the Host', () => {
  const page = name => read(`../../codocs/app/pages/mydocs/${name}.vue`)
  const favorites = page('favorites')
  assert.match(favorites, /query: hosted\s*\? \{ starred: true, page: page\.value, pageSize \}\s*: \{ owner: uid\.value, starred: true, page: page\.value, limit: pageSize \}/)
  const recently = page('recently')
  assert.match(recently, /query: hosted\s*\? \{ page: page\.value, pageSize \}\s*: \{ last_editor: userId\.value, page: page\.value, limit: pageSize \}/)
  assert.match(page('journal'), /query: hosted \? \{ year: yr \} : \{ owner: uid\.value, year: yr \}/)
  assert.match(page('index'), /type: 'private', \.\.\.\(hosted \? \{\} : \{ owner: actor \}\)/)
  assert.match(page('recycle'), /type: 'private', \.\.\.\(hosted \? \{\} : \{ owner: uid\.value \}\)/)
  // Keys the Runtime personal-document list accepts; limit/last_editor are not among them.
  const runtime = read('../../data-runtime/internal/server/enterprise_codocs_reads.go')
  assert.match(runtime, /"list": +\{[^}]*QueryKeys: \[\]string\{"page", "pageSize", "type", "folder_id", "starred", "exclude_worklogs", "search", "sort", "order"\}/)
})

test('a failed folder delete keeps the folder and reports why', () => {
  const source = read('../../codocs/app/pages/mydocs/index.vue')
  const start = source.indexOf('const executeDelete = async')
  const body = source.slice(start, source.indexOf('\n}\n', start))
  // The tree is re-read only after the DELETE resolves.
  assert.ok(body.indexOf('method: \'DELETE\' })') < body.indexOf('await refreshFolders()'))
  assert.match(body, /catch \(err: unknown\) \{\s*toast\.add\(\{ title: target\.type === 'folder' \? '删除文件夹失败' : '删除文档失败', description: deleteFailureMessage\(err\), color: 'error' \}\)/)
  assert.match(source, /if \(status === 401\) return '登录状态已失效/)
})
