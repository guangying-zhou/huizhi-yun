import test from 'node:test'
import assert from 'node:assert/strict'
import { startFeedbackWake } from '../feedback-wake.mjs'
const profile = { features: { feedbackDeliveryEnabled: true }, listeners: { console: { port: 23100 } } }
const tenant = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } } }
test('feedback owner is off by default and rejects wrong bindings', () => {
  let scheduled = 0
  startFeedbackWake({ profile: { features: {} }, schedule: () => scheduled++ })
  assert.equal(scheduled, 0)
  for (const wrong of [{ ...tenant, environment: 'prod' }, { ...tenant, tenantCode: 'other' }, { ...tenant, apps: { console: { deploymentCode: 'wrong' } } }]) {
    assert.throws(() => startFeedbackWake({ profile, tenant: wrong }), /binding mismatch/)
  }
})
test('one signed bounded owner only wakes feedback and prevents overlap', async () => {
  let tick, requests = 0, release, stopped = false
  const wait = new Promise(resolve => { release = resolve })
  const stop = startFeedbackWake({ profile, tenant, secret: 'fixture-secret', facade: { headers: async () => new Headers() },
    schedule: (callback, interval) => { tick = callback; assert.equal(interval, 30000); return {} }, cancel: () => { stopped = true },
    fetchImpl: async (url, init) => {
      requests++
      assert.equal(url, 'http://127.0.0.1:23100/console/api/internal/integration-operations/drain')
      assert.deepEqual(JSON.parse(init.body), { feedbackOnly: true, phase: requests === 1 ? 'issue' : 'notification' })
      assert.equal(init.redirect, 'manual')
      assert.ok(init.headers.get('x-hzy-gateway-signature'))
      await wait
      return { status: 200 }
    }
  })
  const running = tick()
  await tick()
  release()
  await running
  assert.equal(requests, 1)
  await tick()
  assert.equal(requests, 2)
  stop()
  assert.equal(stopped, true)
})
