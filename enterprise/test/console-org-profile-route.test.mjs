import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('org profile BFF is an exact no-query read and preserves Console statuses', async () => {
  const seen = []
  globalThis.__orgProfileTest = { seen, status: 0 }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent('export async function fetchConsoleUserApi(event,id){const s=globalThis.__orgProfileTest;s.seen.push(id);if(s.status)throw Object.assign(Error("Console"),{statusCode:s.status,unhandled:false});return {tenantCode:"T1",orgName:"企业"}}')}`
    }
    return next(specifier, context)
  } })
  let server
  try {
    const handler = (await import('../server/routes/enterprise/api/org-profile.get.ts')).default
    const app = createApp().use(createRouter().get('/enterprise/api/org-profile', handler))
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = query => fetch(`http://127.0.0.1:${server.address().port}/enterprise/api/org-profile${query}`)
    const response = await request('')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.tenantCode, 'T1')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(seen, ['org-profile.read'])
    for (const query of ['?uid=other', '?include=secrets', '?x=a&x=b']) assert.equal((await request(query)).status, 400)
    assert.equal(seen.length, 1)
    for (const status of [401, 403, 503]) {
      globalThis.__orgProfileTest.status = status
      assert.equal((await request('')).status, status)
    }
    assert.equal(isBusinessApiReady('GET', '/enterprise/api/org-profile'), true)
    assert.equal(isBusinessApiReady('PUT', '/enterprise/api/org-profile'), false)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    delete globalThis.__orgProfileTest
  }
})
