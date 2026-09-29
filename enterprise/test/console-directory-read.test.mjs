import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

const cases = [
  { path: '/enterprise/api/directory/committees', file: 'committees/index', id: 'directory.committees.list', valid: '?page=2&pageSize=20&search=委员会&status=all', invalid: ['?page=0', '?pageSize=101', '?status=root', '?uid=forged', '?search=a&search=b'] },
  { path: '/enterprise/api/directory/committees/:committeeCode/members', file: 'committees/[committeeCode]/members', id: 'directory.committees.members.list', param: 'committeeCode', valid: '/U1/members?page=2&pageSize=20&role=leader', invalid: ['/../members', '/bad%20id/members', '/U1/members?role=root', '/U1/members?uid=forged', '/U1/members?pageSize=101'] },
  { path: '/enterprise/api/directory/projects', file: 'projects/index', id: 'directory.projects.list', valid: '?page=2&pageSize=20&search=项目&deptCode=D1&leaderUid=U1&status=archived', invalid: ['?page=0', '?pageSize=101', '?leaderUid=..', '?status=root', '?includeTemplate=1', '?search=a&search=b'] },
  { path: '/enterprise/api/directory/projects/members', file: 'projects/members', id: 'directory.projects.members.list', valid: '?projectCode=P1&page=2&pageSize=20&status=active', invalid: ['', '?page=2', '?projectCode=..', '?projectCode=P1&uid=forged', '?projectCode=P1&pageSize=101'] },
  { path: '/enterprise/api/directory/projects/:projectCode', file: 'projects/[projectCode]', id: 'directory.projects.read', param: 'projectCode', valid: '/U1', invalid: ['/..', '/bad%20id', '/U1?include=secrets'] },
  { path: '/enterprise/api/directory/departments', file: 'departments/index', id: 'directory.departments.list', valid: '', invalid: ['?page=1', '?search=foo', '?uid=other'] },
  { path: '/enterprise/api/directory/departments/:deptCode', file: 'departments/[deptCode]', id: 'directory.departments.read', param: 'deptCode', valid: '/U1', invalid: ['/..', '/bad%20id', '/U1?search=foo'] },
  { path: '/enterprise/api/directory/users', file: 'users/index', id: 'directory.users.list', valid: '?page=2&pageSize=20&search=名字&deptCode=D1&status=all', invalid: ['?page=0', '?page=1e2', '?pageSize=101', '?search=' + 'a'.repeat(101), '?status=root', '?deptCode=..', '?uid=forged', '?search=a&search=b'] },
  { path: '/enterprise/api/directory/users/:uid', file: 'users/[uid]', id: 'directory.users.read', param: 'uid', valid: '/U1', invalid: ['/..', '/bad%20id', '/U1?uid=forged', '/U1?include=secrets'] }
]
test('Console directory BFFs validate exact reads and preserve upstream statuses', async () => {
  const state = { seen: [], status: 0 }
  globalThis.__directoryReadTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__directoryReadTest;s.seen.push({id,options});if(s.status)throw Object.assign(Error("Console"),{statusCode:s.status});return {items:[],total:0}}')}` }
    if (specifier.endsWith('/utils/consoleDirectoryPermissions')) return { shortCircuit: true, url: 'data:text/javascript,export async function consoleDirectoryEditPermission(){return false}' }
    if (specifier.endsWith('/utils/consoleDirectoryRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    for (const item of cases) router.get(item.path, (await import(`../server/routes/enterprise/api/directory/${item.file}.get.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
    for (const item of cases) {
      const base = item.param ? item.path.slice(0, item.path.indexOf(`/:${item.param}`)) : item.path
      const response = await request(base + item.valid)
      assert.equal(response.status, 200, item.id)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(state.seen.at(-1).id, item.id)
      if (item.param) assert.equal(state.seen.at(-1).options.params[item.param], 'U1')
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
      assert.equal(isBusinessApiReady('POST', item.path), ['directory.departments.list', 'directory.projects.list', 'directory.projects.members.list', 'directory.committees.list', 'directory.committees.members.list'].includes(item.id))
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__directoryReadTest
  }
})
