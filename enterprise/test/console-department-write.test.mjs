import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('department BFF writes validate key/body/path, preserve denial and exact registration', async () => {
  const state = { seen: [], status: 0 }
  globalThis.__departmentWrite = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__departmentWrite;s.seen.push({id,options,key:event.node.req.headers["idempotency-key"]});if(s.status)throw Object.assign(Error("denied"),{statusCode:s.status});return {ok:true}}')}` }
    if (specifier.endsWith('/utils/consoleDepartmentWrite') || specifier.endsWith('/consoleDirectoryRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    const cases = [
      ['POST', '/enterprise/api/directory/departments', 'index.post', 'create', { deptCode: 'D1', name: '研发部' }],
      ['PATCH', '/enterprise/api/directory/departments/D1', '[deptCode].patch', 'update', { name: '研发部门' }],
      ['DELETE', '/enterprise/api/directory/departments/D1', '[deptCode].delete', 'delete', {}]
    ]
    for (const [method, path, file] of cases) router[method.toLowerCase()](path.replace('/D1', '/:deptCode'), (await import(`../server/routes/enterprise/api/directory/departments/${file}.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = (method, path, body, key = 'directory:department:test0001') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
    for (const [method, path, , action, body] of cases) {
      const count = state.seen.length
      assert.equal((await request(method, path, body, '')).status, 400)
      assert.equal((await request(method, path, body, 'invalid.key')).status, 400)
      assert.equal((await request(method, path + '?uid=forged', body)).status, 400)
      for (const invalid of [[], null, { ...body, actorUid: 'forged' }, { ...body, expectedRevision: 1 }, { ...body, status: 'deleted' }]) assert.equal((await request(method, path, invalid)).status, 400)
      if (method === 'PATCH') {
        for (const invalid of [{}, { deptCode: 'D2' }, { managerId: '../other' }, { orgType: 'root' }, { sortOrder: '1' }]) assert.equal((await request(method, path, invalid)).status, 400)
        assert.ok([400, 404].includes((await request(method, path.replace('/D1', '/bad%20id'), body)).status))
      }
      assert.equal(state.seen.length, count)
      const response = await request(method, path, body)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(state.seen.at(-1).id, `directory.departments.${action}`)
      assert.deepEqual(state.seen.at(-1).options.body, body)
      assert.equal(state.seen.at(-1).key, 'directory:department:test0001')
      state.status = 403
      assert.equal((await request(method, path, body)).status, 403)
      state.status = 0
      assert.equal(isBusinessApiReady(method, path), true)
      assert.equal(isBusinessApiReady('PUT', path), false)
    }
    assert.equal(isBusinessApiReady('POST', '/enterprise/api/directory/departments/D1'), false)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__departmentWrite
  }
})
