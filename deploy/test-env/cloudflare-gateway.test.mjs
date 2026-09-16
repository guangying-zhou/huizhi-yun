import test from 'node:test'
import assert from 'node:assert/strict'
import gateway from './cloudflare-gateway.mjs'

test('applications without test bindings cannot fall back to production origins', async () => {
  for (const app of ['altoc', 'codocs', 'people', 'workflow', 'webdev', 'collab', 'directory-connector']) {
    const r = await gateway.fetch(new Request(`https://hzy-test.huizhi.yun/${app}/`), {})
    assert.equal(r.status, 503)
  }
})

test('maintenance sync requires exact test host, POST and gateway credential', async () => {
  for (const [url, method, token] of [
    ['https://other.huizhi.yun/__test/policy-sync', 'POST', 'test-key'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'GET', 'test-key'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'POST', 'wrong'],
    ['https://hzy-test.huizhi.yun/__test/policy-sync', 'POST', ''],
  ]) {
    let called = false
    const r = await gateway.fetch(new Request(url, { method, headers: { authorization: `Bearer ${token}` } }), {
      HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'test-key',
      HZY_CONSOLE_SERVICE: { fetch() { called = true; throw Error('must not call') } },
    })
    assert.equal(r.status, 404); assert.equal(called, false)
  }
})
