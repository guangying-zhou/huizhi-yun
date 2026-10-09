import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rolloutProbeMatrix, runRolloutProbe } from '../probe-c000001-rollout-service-tokens.mjs'

function jwt(item) {
  const claims = { aud: item.audience, scope: item.scope, source_app: item.app, tenant: 'C000001',
    deployment: item.client === 'enterprise.runtime' ? 'C000001-test-enterprise'
      : item.client === 'workflow.runtime' ? 'C000001-test-workflow-local' : 'C000001-test-aims' }
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

test('all five Host domains and both scheduler audiences use the real client matrix, without token output', async () => {
  const logs = [], requested = []
  await runRolloutProbe(async item => {
    requested.push(item)
    if (item.expectStatus === 403) return { status: 403, json: async () => ({ error: 'insufficient_scope' }) }
    return { status: 200, json: async () => ({ access_token: jwt(item) }) }
  }, line => logs.push(line))
  assert.equal(requested.length, 13)
  assert.equal(requested.filter(item => item.client === 'enterprise.runtime').length, 5)
  assert.equal(requested.filter(item => item.client === 'workflow.runtime').length, 2)
  assert.equal(requested.filter(item => item.client === 'aims.runtime').length, 6)
  assert.deepEqual(requested, rolloutProbeMatrix)
  assert.deepEqual(requested.filter(item => item.expectStatus === 403).map(item => item.scope),
    ['aims:notifications-due:execute', 'aims:notifications-due:execute'])
  assert.ok(logs.every(line => Object.keys(JSON.parse(line)).sort().join(',') === 'audience,expected,scope,status'))
  assert.ok(!logs.join('').includes('access_token'))
})

test('wrong claims fail closed without emitting the JWT', async () => {
  const logs = []
  await assert.rejects(runRolloutProbe(async item => ({ status: 200,
    json: async () => ({ access_token: jwt({ ...item, audience: 'wrong' }) }) }), line => logs.push(line)), /ROLLOUT_TOKEN_PROBE_FAILED/)
  assert.equal(logs.length, 1)
  assert.deepEqual(JSON.parse(logs[0]), { scope: rolloutProbeMatrix[0].scope, audience: 'data-runtime', status: 200 })
})

test('a granted notifications-due scope is unexpected under D4', async () => {
  await assert.rejects(runRolloutProbe(async item => ({ status: 200,
    json: async () => ({ access_token: jwt(item) }) }), () => {}), /ROLLOUT_TOKEN_PROBE_UNEXPECTED/)
})

test('report mode logs every refusal without stopping', async () => {
  const logs = []
  await runRolloutProbe(async () => ({ status: 403, json: async () => ({}) }), line => logs.push(line), { reportOnly: true })
  assert.equal(logs.length, rolloutProbeMatrix.length)
})
