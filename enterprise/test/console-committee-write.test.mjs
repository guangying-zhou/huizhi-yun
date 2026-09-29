import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('committee BFF writes validate key/body/path, preserve denial and exact registration', async () => {
  const state = { seen: [], status: 0 }
  globalThis.__committeeWrite = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id,options){const s=globalThis.__committeeWrite;s.seen.push({id,options,key:event.node.req.headers["idempotency-key"]});if(s.status)throw Object.assign(Error("denied"),{statusCode:s.status});return {ok:true}}')}` }
    if (specifier.endsWith('/utils/consoleCommitteeWrite') || specifier.endsWith('/consoleDirectoryRead')) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    const cases = [
      ['POST', '/enterprise/api/directory/committees', 'index.post', 'create', { committeeCode: 'C1', name: '委员会' }],
      ['PATCH', '/enterprise/api/directory/committees/C1', '[committeeCode].patch', 'update', { name: '新版' }],
      ['DELETE', '/enterprise/api/directory/committees/C1', '[committeeCode].delete', 'delete', {}],
      ['POST', '/enterprise/api/directory/committees/C1/members', '[committeeCode]/members.post', 'members.save', { members: [{ uid: 'U1', role: 'member' }] }],
      ['PATCH', '/enterprise/api/directory/committees/C1/members/U1', '[committeeCode]/members/[uid].patch', 'members.update', { role: 'leader' }],
      ['DELETE', '/enterprise/api/directory/committees/C1/members/U1', '[committeeCode]/members/[uid].delete', 'members.remove', {}]
    ]
    for (const [method, path, file] of cases) router[method.toLowerCase()](path.replace('/C1', '/:committeeCode').replace('/U1', '/:uid'), (await import(`../server/routes/enterprise/api/directory/committees/${file}.ts`)).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = (method, path, body, key = 'directory:committee:test0001') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
    for (const [method, path, , action, body] of cases) {
      const count = state.seen.length
      assert.equal((await request(method, path, body, '')).status, 400)
      assert.equal((await request(method, path, body, 'invalid.key')).status, 400)
      assert.equal((await request(method, path + '?uid=forged', body)).status, 400)
      for (const invalid of [[], null, { ...body, actorUid: 'forged' }, { ...body, expectedRevision: 1 }, { ...body, status: 'deleted' }]) assert.equal((await request(method, path, invalid)).status, 400)
      if (action === 'update') {
        for (const invalid of [{}, { committeeCode: 'C2' }, { parentDeptCode: '../other' }, { sortOrder: -1 }, { status: 'deleted' }]) assert.equal((await request(method, path, invalid)).status, 400)
        assert.ok([400, 404].includes((await request(method, path.replace('/C1', '/bad%20id'), body)).status))
      }
      if (action === 'members.update') {
        for (const invalid of [{}, { role: 'root' }, { role: null }, { role: 'leader', uid: 'forged' }]) assert.equal((await request(method, path, invalid)).status, 400)
      }
      if (path.includes('/C1')) assert.ok([400, 404].includes((await request(method, path.replace('/C1', '/bad%20code'), body)).status))
      if (path.includes('/U1')) assert.ok([400, 404].includes((await request(method, path.replace('/U1', '/bad%20uid'), body)).status))
      assert.equal(state.seen.length, count)
      if (action === 'members.save') {
        for (const members of [null, {}, Array.from({ length: 101 }, (_, i) => ({ uid: `U${i}`, role: 'member' })), [{ uid: 'U1', role: 'root' }], [{ uid: 'U1', role: 'member', actorUid: 'forged' }], [{ uid: 'U1', role: 'member' }, { uid: 'U1', role: 'observer' }]]) assert.equal((await request(method, path, { members })).status, 400)
        assert.equal((await request(method, path, { members: [] })).status, 400)
        assert.equal((await request(method, path, { members: [{ uid: 'U1', role: 'leader' }, { uid: 'U2', role: 'leader' }] })).status, 400)
      }
      const response = await request(method, path, body)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(state.seen.at(-1).id, `directory.committees.${action}`)
      assert.deepEqual(state.seen.at(-1).options.body, body)
      assert.equal(state.seen.at(-1).key, 'directory:committee:test0001')
      state.status = 403
      assert.equal((await request(method, path, body)).status, 403)
      state.status = 0
      assert.equal(isBusinessApiReady(method, path), true)
      assert.equal(isBusinessApiReady('PUT', path), false)
    }
    assert.equal((await request('POST', '/enterprise/api/directory/committees', { committeeCode: 'C1', name: 'Large', description: 'a'.repeat(32769) })).status, 413)
    assert.equal(isBusinessApiReady('POST', '/enterprise/api/directory/committees/C1'), false)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__committeeWrite
  }
})
