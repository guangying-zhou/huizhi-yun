import assert from 'node:assert/strict'
import test from 'node:test'
import { probeWorker } from '../probe-worker-health.mjs'

test('worker probe requires an actual bounded Nitro response, not an open port', async () => {
  const url = 'http://127.0.0.1:23180/enterprise/_hzy0_worker_health'
  let options
  const healthy = await probeWorker(url, 'fixture', async (target, init) => {
    assert.equal(target, url)
    options = init
    return Response.json({ status: 'ok', pid: 123, rssBytes: 1000, heapUsedBytes: 500 })
  })
  assert.equal(healthy.healthy, true)
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers['x-hzy0-local-health'], 'fixture')
  assert.ok(options.signal instanceof AbortSignal)
  for (const response of [new Response(null, { status: 204 }), Response.json({ status: 'ok' }), Response.json({ status: 'fail', pid: 123 })]) {
    assert.equal((await probeWorker(url, 'fixture', async () => response)).healthy, false)
  }
  assert.equal((await probeWorker(url, 'fixture', async () => { throw Error('private diagnostic') })).healthy, false)
})
