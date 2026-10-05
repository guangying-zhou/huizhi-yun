import assert from 'node:assert/strict'
import test from 'node:test'
import type { H3Event } from 'h3'
import { measureRequestStage } from '../server/utils/performanceTiming'

function event(enabled: boolean) {
  const headers = new Map<string, unknown>()
  return {
    headers,
    request: {
      context: { cloudflare: { env: { HZY_PERF_TIMING_ENABLED: enabled ? 'true' : 'false' } } },
      node: { res: {
        getHeader: (key: string) => headers.get(key),
        setHeader: (key: string, value: unknown) => headers.set(key, value)
      } }
    } as unknown as H3Event
  }
}

test('timing is opt-in and preserves results and errors', async () => {
  const off = event(false)
  assert.equal(await measureRequestStage(off.request, 'test', async () => 42), 42)
  assert.equal(off.headers.size, 0)
  const on = event(true)
  assert.equal(await measureRequestStage(on.request, 'test', async () => 42), 42)
  assert.match(String(on.headers.get('server-timing')), /test;dur=\d/)
  await assert.rejects(measureRequestStage(on.request, 'failed', async () => {
    throw new Error('denied')
  }), /denied/)
  assert.match(String(on.headers.get('server-timing')), /failed;dur=\d/)
})
