import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OIDC_RENEW_BEFORE_EXPIRY_MS, createOidcTokenRenewal } from '../app/utils/oidcTokenRenewal.ts'

function harness(options: { refresh?: () => Promise<unknown> } = {}) {
  let time = 1_000_000
  let expiry: number | null = (time + 15 * 60_000) / 1000
  const timers: { callback: () => void, delay: number }[] = []
  let refreshes = 0
  const renewal = createOidcTokenRenewal({
    getExpiry: () => expiry,
    refresh: async () => {
      refreshes++
      if (options.refresh) return options.refresh()
      expiry = (time + 15 * 60_000) / 1000
    },
    now: () => time,
    setTimer: (callback, delay) => {
      const timer = { callback, delay }
      timers.push(timer)
      return timer
    },
    clearTimer: timer => timers.splice(timers.indexOf(timer as never), 1)
  })
  return {
    renewal, timers,
    get refreshes() { return refreshes },
    advance: (ms: number) => { time += ms },
    setExpiry: (value: number | null) => { expiry = value },
    now: () => time
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('renews one minute before the access token expires and re-plans from the new token', async () => {
  const h = harness()
  h.renewal.schedule()
  assert.equal(h.timers.length, 1)
  assert.equal(h.timers[0]!.delay, 15 * 60_000 - OIDC_RENEW_BEFORE_EXPIRY_MS)
  h.advance(h.timers[0]!.delay)
  h.timers.shift()!.callback()
  await settle()
  assert.equal(h.refreshes, 1)
  assert.equal(h.timers.length, 1, 'the renewed token is scheduled again')
  assert.equal(h.timers[0]!.delay, 15 * 60_000 - OIDC_RENEW_BEFORE_EXPIRY_MS)
})

test('no token schedules nothing; a nearly expired token renews after a short floor', () => {
  const h = harness()
  h.setExpiry(null)
  h.renewal.schedule()
  assert.equal(h.timers.length, 0)
  h.setExpiry((h.now() + 30_000) / 1000)
  h.renewal.schedule()
  assert.equal(h.timers[0]!.delay, 5_000)
})

test('a failed renewal does not loop; a new token or a wake tries again', async () => {
  const h = harness({
    refresh: async () => {
      throw Error('refresh token rejected')
    }
  })
  h.renewal.schedule()
  h.advance(h.timers[0]!.delay)
  h.timers.shift()!.callback()
  await settle()
  assert.equal(h.refreshes, 1)
  assert.equal(h.timers.length, 0, 'no retry loop for the same expired token')
  await h.renewal.wake()
  await settle()
  assert.equal(h.refreshes, 2, 'focus renews at once when the token is already due')
  h.setExpiry((h.now() + 15 * 60_000) / 1000)
  h.renewal.schedule()
  assert.equal(h.timers.length, 1, 'a new token is scheduled normally')
})

test('wake only renews when due; otherwise it just re-plans', async () => {
  const h = harness()
  await h.renewal.wake()
  assert.equal(h.refreshes, 0)
  assert.equal(h.timers.length, 1)
  h.advance(15 * 60_000)
  await h.renewal.wake()
  await settle()
  assert.equal(h.refreshes, 1)
})

test('the client plugin wires renewal to the Console OIDC token and page visibility', () => {
  const source = readFileSync(new URL('../app/plugins/console-oidc-renewal.client.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(!auth\.enabled\.value\) return/)
  assert.match(source, /getExpiry: \(\) => \(auth\.token\.value \? auth\.claims\.value\?\.exp : null\)/)
  assert.match(source, /refresh: \(\) => auth\.refresh\(\)/)
  assert.match(source, /addEventListener\('visibilitychange', wake\)/)
})
