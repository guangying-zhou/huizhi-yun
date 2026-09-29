import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('project BFF writes validate key/body/path, preserve denial and exact registration', async () => {
  const state = { seen: [], status: 0 }
  globalThis.__projectWrite = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__projectWrite;s.seen.push({id,options,key:event.node.req.headers["idempotency-key"]});if(s.status)throw Object.assign(Error("denied"),{statusCode:s.status});return {ok:true}}')}` }
    if (specifier.endsWith('/utils/consoleProjectWrite') || specifier.endsWith('/consoleDirectoryRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    const cases = [
      ['POST', '/enterprise/api/directory/projects', 'index.post', 'create', { projectCode: 'P1', name: '研发项目' }],
      ['PATCH', '/enterprise/api/directory/projects/P1', '[projectCode].patch', 'update', { name: '研发项目新版' }],
      ['DELETE', '/enterprise/api/directory/projects/P1', '[projectCode].delete', 'delete', {}],
      ['POST', '/enterprise/api/directory/projects/members', 'members.post', 'members.replace', { projectCode: 'P1', members: [{ uid: 'U1', role: 'member' }] }]
    ]
    for (const [method, path, file] of cases) router[method.toLowerCase()](path.replace('/P1', '/:projectCode'), (await import(`../server/routes/enterprise/api/directory/projects/${file}.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = (method, path, body, key = 'directory:project:test0001') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
    for (const [method, path, , action, body] of cases) {
      const count = state.seen.length
      assert.equal((await request(method, path, body, '')).status, 400)
      assert.equal((await request(method, path, body, 'invalid.key')).status, 400)
      assert.equal((await request(method, path + '?uid=forged', body)).status, 400)
      for (const invalid of [[], null, { ...body, actorUid: 'forged' }, { ...body, expectedRevision: 1 }, { ...body, status: 'deleted' }]) assert.equal((await request(method, path, invalid)).status, 400)
      if (method === 'PATCH') {
        for (const invalid of [{}, { projectCode: 'P2' }, { leaderUid: '../other' }, { projectType: 'root' }, { status: 'deleted' }]) assert.equal((await request(method, path, invalid)).status, 400)
        assert.ok([400, 404].includes((await request(method, path.replace('/P1', '/bad%20id'), body)).status))
      }
      assert.equal(state.seen.length, count)
      if (action === 'members.replace') {
        for (const members of [null, {}, Array.from({ length: 101 }, (_, i) => ({ uid: `U${i}`, role: 'member' })), [{ uid: 'U1', role: 'root' }], [{ uid: 'U1', role: 'member', actorUid: 'forged' }], [{ uid: 'U1', role: 'member' }, { uid: 'U1', role: 'admin' }]]) assert.equal((await request(method, path, { projectCode: 'P1', members })).status, 400)
        assert.equal((await request(method, path, { projectCode: 'P1', members: [] })).status, 200, 'empty replacement is intentional and valid')
      }
      const response = await request(method, path, body)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(state.seen.at(-1).id, `directory.projects.${action}`)
      assert.deepEqual(state.seen.at(-1).options.body, body)
      assert.equal(state.seen.at(-1).key, 'directory:project:test0001')
      state.status = 403
      assert.equal((await request(method, path, body)).status, 403)
      state.status = 0
      assert.equal(isBusinessApiReady(method, path), true)
      assert.equal(isBusinessApiReady('PUT', path), false)
    }
    for (const method of ['PATCH', 'DELETE']) assert.equal((await request(method, '/enterprise/api/directory/projects/members', {})).status, 400)
    assert.equal((await request('POST', '/enterprise/api/directory/projects', { projectCode: 'members', name: 'Reserved' })).status, 400)
    assert.equal((await request('POST', '/enterprise/api/directory/projects/members', { projectCode: 'members', members: [] })).status, 400)
    assert.equal((await request('POST', '/enterprise/api/directory/projects', { projectCode: 'P1', name: 'Large', description: 'a'.repeat(32769) })).status, 413)
    assert.equal(isBusinessApiReady('POST', '/enterprise/api/directory/projects/P1'), false)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__projectWrite
  }
})
