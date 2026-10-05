import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspacePath(path: string) {
  return new URL(`../../${path}`, import.meta.url)
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

test('shared heartbeat binds the verified user and server-side application identity', () => {
  const route = source('server/api/heartbeat.post.ts')
  const bridge = source('server/utils/consoleSessionBridge.ts')

  assertBefore(route, 'requireFoundationSessionUid(event)', 'readBody<HeartbeatBody>(event)')
  assert.match(route, /config\.public\?\.appCode \|\| config\.public\?\.appName/)
  assert.match(route, /fetchConsoleSessionApi\(event, '\/api\/v1\/heartbeat'/)
  assert.match(route, /sourceApp: appCode/)
  assert.doesNotMatch(route, /body\.sourceApp|body\.uid/)
  assert.match(bridge, /upstreamStatus >= 400 && upstreamStatus < 500 \? upstreamStatus : 503/)
  assert.match(bridge, /statusCode === 401[\s\S]*'请先登录'/)
})

test('heartbeat client uses the shared BFF for business apps and the local Console endpoint for Console', () => {
  const composable = source('app/composables/useHeartbeat.ts')

  assert.match(composable, /consoleApp \? '\/api\/v1\/heartbeat' : '\/api\/heartbeat'/)
  assert.match(composable, /consoleApp \? \{ sourceApp: code \} : \{\}/)
  assert.match(composable, /\[authenticated, user, \(\) => route\.path\]/)
  assert.match(composable, /\{ immediate: true \}/)
  assert.match(composable, /setInterval\([\s\S]*120_000/)
  assert.match(composable, /console\.warn\('\[heartbeat\] Presence report failed:'/)
})

test('business applications do not override the shared presence route or composable', () => {
  for (const app of ['aims', 'altoc', 'assets', 'codocs', 'finance', 'people', 'webdev', 'workflow']) {
    assert.equal(
      existsSync(workspacePath(`${app}/server/api/heartbeat.post.ts`)),
      false,
      `${app} must inherit the Foundation heartbeat BFF`
    )
  }

  for (const app of ['assets', 'codocs']) {
    assert.equal(
      existsSync(workspacePath(`${app}/app/composables/useHeartbeat.ts`)),
      false,
      `${app} must inherit the Foundation heartbeat composable`
    )
  }
})
