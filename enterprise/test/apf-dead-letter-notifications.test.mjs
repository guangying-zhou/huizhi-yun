import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const hooks = registerHooks({ resolve(s, c, next) {
  const sources = { 'h3': `export const createError=x=>Object.assign(Error('fixed'),x)`,
    '@hzy/foundation/server/utils/enterpriseRuntimeChannels': `export const callEnterpriseAPFDeadLetterWorker=async()=>{throw Error('no live Runtime')}`,
    '@hzy/foundation/server/utils/notifications': `export const publishIntegrationOperationDeadLetter=async()=>{throw Error('no network')};export const advanceNotificationActionableLifecycle=async()=>{throw Error('no network')}`,
    '@hzy/foundation/server/utils/tenantGatewayTrust': `export const resolveTrustedTenantGatewayContext=()=>null` }
  return sources[s] ? { url: 'data:text/javascript,' + encodeURIComponent(sources[s]), shortCircuit: true } : next(s, c)
} })
const { drainEnterpriseAPFDeadLetter } = await import('../server/utils/enterpriseAPFDeadLetterDelivery.ts')
hooks.deregister()
function fixture(domain = 'altoc') {
  const id = '90b90bf3-5899-4aed-98c8-23dd1897f463'
  const source = domain === 'people' ? 'enterprise' : domain
  const c = { OperationID: id, TargetApp: 'workflow', OperationCode: 'test.approval.v1', SourceBizType: 'fixture', SourceBizCode: 'F1', LastErrorCode: 'timeout', LastErrorClass: 'transient', OriginalActorUID: 'Owner', ActionableKey: `integration-operation:${source}:${id}:dead-letter:g4`, ObjectVersion: 'dead-letter:g4:operation-v4', Generation: 4, OperationVersion: 4, AttemptCount: 8, MaxAttempts: 8, DeadLetteredAt: '2026-10-03T00:00:00Z' }
  const calls = []
  let ackFail = false
  let pubFail = false
  let receipt = { notificationId: 'N1', recipients: ['Owner'] }
  const closure = { OperationID: id, Generation: 4, ActionableKey: c.ActionableKey, ExpectedVersion: c.ObjectVersion, NextVersion: 'cancelled:g4:operation-v5', State: 'cancelled', RecipientUIDs: ['Owner'] }
  const dep = { env: { [`HZY_ENTERPRISE_${domain.toUpperCase()}_DEAD_LETTER_NOTIFICATIONS_ENABLED`]: 'true', [`HZY_${domain.toUpperCase()}_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED`]: 'false' }, now: () => 0, binding: () => ({ tenant: 'T1', deployment: 'HOST' }),
    runtime: async (_event, d, op, body) => {
      calls.push(['runtime', d, op, body])
      if (op === 'pending-dead-letter-actionables')
        return { code: 0, data: [c] }
      if (op === 'pending-dead-letter-closures')
        return { code: 0, data: ackFail ? [] : [closure] }
      if (ackFail)
        throw Error('fixed')
      return { code: 0, data: true }
    },
    publish: async (input) => {
      calls.push(['publish', input])
      if (pubFail)
        throw Error('fixed')
      return receipt
    }, close: async (input) => {
      calls.push(['close', input])
    } }
  return { dep, c, closure, calls, ackFail: x => ackFail = x, pubFail: x => pubFail = x, receipt: x => receipt = x }
}
test('default off and absent/enabled old owner make no token or network calls', async () => {
  for (const env of [{}, { HZY_ENTERPRISE_ALTOC_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'true' }, { HZY_ENTERPRISE_ALTOC_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'true', HZY_ALTOC_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED: 'true' }]) {
    const f = fixture()
    await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', { ...f.dep, env })
    assert.equal(f.calls.length, 0)
  }
})
test('three domain passes retain original keys and fresh Enterprise publisher, creation then closure', async () => {
  for (const domain of ['altoc', 'finance', 'people']) {
    const f = fixture(domain)
    const out = await drainEnterpriseAPFDeadLetter({ context: {} }, domain, f.dep)
    assert.deepEqual(out, { published: 1, closed: 1, failed: 0, disabled: false })
    const p = f.calls.find(c => c[0] === 'publish')[1]
    assert.equal(p.sourceApp, 'enterprise')
    assert.equal(p.moduleAppCode, domain)
    assert.equal(p.actionableKey, f.c.ActionableKey)
    assert.equal(p.generation, 4)
    assert.equal(p.tenantCode, 'T1')
    assert.equal(p.deploymentCode, 'HOST')
    assert.deepEqual(f.calls.find(c => c[0] === 'close')[1], { sourceAppCode: 'enterprise', actionableKey: f.c.ActionableKey, expectedVersion: f.c.ObjectVersion, nextVersion: f.closure.NextVersion, state: 'cancelled', recipients: ['Owner'] })
    assert.ok(f.calls.findIndex(c => c[2] === 'dead-letter-actionable-published') < f.calls.findIndex(c => c[0] === 'close'))
  }
})
test('lost ACK repeats exact original publish; malformed or absent target receipt never acknowledges', async () => {
  const f = fixture()
  f.ackFail(true)
  await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', f.dep)
  f.ackFail(false)
  await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', f.dep)
  assert.deepEqual(f.calls.filter(c => c[0] === 'publish')[0][1], f.calls.filter(c => c[0] === 'publish')[1][1])
  for (const receipt of [{}, { notificationId: 'N1', recipients: ['@all'] }, { notificationId: 'N1', recipients: ['Owner', 'Owner'] }]) {
    const x = fixture()
    x.receipt(receipt)
    await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', x.dep)
    assert.equal(x.calls.filter(c => c[2] === 'dead-letter-actionable-published').length, 0)
  }
})
test('wrong key/generation/foreign target, failures and time budget never synthesize ACK', async () => {
  for (const field of ['ActionableKey', 'Generation', 'ObjectVersion']) {
    const f = fixture()
    f.c[field] = field === 'Generation' ? 0 : 'wrong'
    await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', f.dep)
    assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0)
  }
  const f = fixture()
  f.pubFail(true)
  await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', f.dep)
  assert.equal(f.calls.filter(c => c[2] === 'dead-letter-actionable-published').length, 0)
  const x = fixture()
  let n = 0
  x.dep.now = () => n++ === 0 ? 0 : 20001
  await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', x.dep)
  assert.equal(x.calls.filter(c => c[0] === 'publish' || c[0] === 'close').length, 0)
})
test('a false Runtime receipt cannot count as published or closed', async () => {
  const f = fixture()
  const original = f.dep.runtime
  f.dep.runtime = async (e, d, op, body) => op === 'dead-letter-actionable-published' || op === 'dead-letter-closure-acknowledged' ? { code: 0, data: false } : original(e, d, op, body)
  const result = await drainEnterpriseAPFDeadLetter({ context: {} }, 'altoc', f.dep)
  assert.equal(result.published, 0)
  assert.equal(result.closed, 0)
  assert.equal(result.failed, 2)
})
