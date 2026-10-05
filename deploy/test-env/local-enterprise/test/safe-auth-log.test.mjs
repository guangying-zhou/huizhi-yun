import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeAuthLogLine } from '../safe-auth-log.mjs'

test('auth log reader emits only fixed diagnostic fields', () => {
  const line = `prefix {"event":"console-auth-dependency-failure","requestId":"123e4567-e89b-12d3-a456-426614174000","stage":"runtime-jwks","status":503,"durationMs":17,"cookie":"secret","message":"Bearer secret"}`
  const result = summarizeAuthLogLine(line)
  assert.deepEqual(result, { event: 'console-auth-dependency-failure', requestId: '123e4567-e89b-12d3-a456-426614174000', stage: 'runtime-jwks', status: 503, durationMs: 17 })
  assert.doesNotMatch(JSON.stringify(result), /secret|Bearer/)
  assert.equal(summarizeAuthLogLine('{"event":"other","token":"secret"}'), null)
  assert.equal(summarizeAuthLogLine('{"event":"hzy0-console-egress","path":"/oauth/userinfo?token=secret"}').path, undefined)
  assert.equal(summarizeAuthLogLine('{"event":"console-auth-dependency-failure","stage":"service-token-issue-http","networkCode":"ECONNRESET"}').networkCode, 'ECONNRESET')
  assert.equal(summarizeAuthLogLine('{"event":"console-auth-dependency-failure","stage":"service-token-issue-http","networkCode":"secret"}').networkCode, undefined)
})
