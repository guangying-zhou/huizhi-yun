import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const hooks = registerHooks({ resolve(s, c, next) {
  const sources = {
    'h3': `export const createError=x=>Object.assign(Error('fixed'),x)`,
    '@hzy/foundation/server/utils/enterpriseRuntimeChannels': `export const callEnterprisePeopleDirectoryWorker=(...args)=>globalThis.__peopleBounded.runtime(...args)`,
    '@hzy/foundation/server/utils/directoryServiceCommand': `export const callDirectoryServiceCommand=(...args)=>globalThis.__peopleBounded.target(...args)`
  }
  if (s === '@hzy/foundation/server/utils/serviceOperation') return next(new URL('../../foundation/server/utils/serviceOperation.ts', import.meta.url).href, c)
  return sources[s] ? { url: 'data:text/javascript,' + encodeURIComponent(sources[s]), shortCircuit: true } : next(s, c)
} })
const { drainEnterprisePeopleDirectory } = await import('../server/utils/enterprisePeopleDirectoryDelivery.ts')
hooks.deregister()
function fixture() {
  const calls = []
  const op = { operationId: 'b17fb749-782e-4b48-90ce-744cb312c349', targetApp: 'console', operationCode: 'people.directory.employment-sync.v1', requiredCapability: 'console:directory-employment:sync', idempotencyKey: 'original-key', operationKey: 'original-key', commandSchemaVersion: 'v1', commandSha256: 'a'.repeat(64), command: { employeeUid: 'Employee' }, fencingToken: 7 }
  const reply = { ...op, receiptId: '7c3034e8-53ed-4a47-a813-42a8df128df2', receiptStatus: 'succeeded', targetBizType: 'directory_user', targetBizCode: 'Employee', responseSummarySha256: 'b'.repeat(64), result: { platformStatus: 'pending' } }
  const f = { calls, op, reply, ackError: false, targetError: false, malformed: false }
  globalThis.__peopleBounded = {
    runtime: async (_e, operation, body) => {
      calls.push([operation, body])
      if (operation === 'prepare-due') return { code: 0, data: { prepared: 100, cursor: 'next-page', hasMore: true } }
      if (operation === 'claim') return { code: 0, data: { operation: op } }
      if (operation === 'ack' && f.ackError) throw Object.assign(Error('ack lost'), { statusCode: 503 })
      return { code: 0 }
    },
    target: async (_e, frozen) => {
      calls.push(['target', structuredClone(frozen)])
      if (f.targetError) throw Object.assign(Error('private-url must not escape'), { statusCode: 503 })
      return f.malformed ? { ...reply, targetBizCode: 'Other' } : reply
    }
  }
  return f
}
test('Directory pass prepares one page, claims one command and accepts independent Platform pending', async () => {
  const f = fixture()
  try {
    const out = await drainEnterprisePeopleDirectory({})
    assert.deepEqual(out, { prepared: 100, claimed: 1, delivered: 1, failed: 0, hasMorePreparation: true })
    assert.deepEqual(f.calls.map(c => c[0]), ['prepare-due', 'claim', 'target', 'ack'])
    assert.equal(f.calls.at(-1)[1].fencingToken, 7)
    assert.equal(f.calls.at(-1)[1].receipt.platformStatus, 'pending')
    assert.equal(f.calls.at(-1)[1].receipt.idempotencyKey, 'original-key')
  } finally { delete globalThis.__peopleBounded }
})
test('successful target with lost ACK never records failure and retries the same frozen intent', async () => {
  const f = fixture()
  f.ackError = true
  try {
    await assert.rejects(drainEnterprisePeopleDirectory({}), { statusCode: 503 })
    assert.equal(f.calls.filter(c => c[0] === 'fail').length, 0)
    f.ackError = false
    await drainEnterprisePeopleDirectory({})
    const targets = f.calls.filter(c => c[0] === 'target')
    assert.equal(targets.length, 2)
    assert.deepEqual(targets[0][1], targets[1][1])
  } finally { delete globalThis.__peopleBounded }
})
test('target failure or mismatched receipt fails only the observed lease, with no raw error', async () => {
  for (const mode of ['targetError', 'malformed']) {
    const f = fixture()
    f[mode] = true
    try {
      const out = await drainEnterprisePeopleDirectory({})
      assert.equal(out.failed, 1)
      assert.equal(out.delivered, 0)
      assert.deepEqual(f.calls.at(-1), ['fail', { operationId: f.op.operationId, fencingToken: 7, httpStatus: mode === 'malformed' ? 422 : 503 }])
      assert.equal(f.calls.filter(c => c[0] === 'ack').length, 0)
    } finally { delete globalThis.__peopleBounded }
  }
})
test('elapsed budget stops before claim, preserving preparation continuation for the next wake', async () => {
  const f = fixture()
  const original = Date.now
  let calls = 0
  Date.now = () => calls++ < 2 ? 0 : 25000
  try {
    const out = await drainEnterprisePeopleDirectory({})
    assert.equal(out.claimed, 0)
    assert.equal(out.hasMorePreparation, true)
    assert.deepEqual(f.calls.map(c => c[0]), ['prepare-due'])
  } finally {
    Date.now = original
    delete globalThis.__peopleBounded
  }
})

test('signed wake authentication precedes all queues; one failed queue does not starve the others', async () => {
  const state = { calls: [], denied: true }
  globalThis.__peopleWakeChain = state
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const defineEventHandler=f=>f;export const readBody=async()=>({domain:'people'})`
    if (s === '@hzy/foundation/server/utils/enterpriseRuntimeChannels') source = `export const callEnterpriseAPFScheduler=async()=>{const s=globalThis.__peopleWakeChain;s.calls.push('auth');if(s.denied)throw Object.assign(Error('denied'),{statusCode:403});return {code:0}}`
    const maps = { enterprisePeopleDirectoryDelivery: ['drainEnterprisePeopleDirectory', 'directory'], enterprisePeopleWorkflow: ['resumePeopleAssignmentApprovals', 'approvals'], enterpriseAPFDueDelivery: ['drainEnterpriseAPFDue', 'due'], enterpriseAPFDeadLetterDelivery: ['drainEnterpriseAPFDeadLetter', 'dead'], enterpriseFinanceApproval: ['resumeFinanceApprovals', 'finance'], enterpriseAltocApproval: ['resumeAltocApprovals', 'altoc'] }
    for (const [name, [fn, label]] of Object.entries(maps)) if (s.endsWith('/' + name)) source = `export const ${fn}=async()=>{globalThis.__peopleWakeChain.calls.push('${label}');${label === 'directory' ? 'throw Object.assign(Error(\'dependency\'),{statusCode:503})' : 'return {done:true}'}}`
    return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(s, c)
  } })
  try {
    const { default: wake } = await import('../server/routes/enterprise/api/internal/apf/scheduler-inspect.post.ts?bounded-chain')
    await assert.rejects(wake({}), { statusCode: 403 })
    assert.deepEqual(state.calls, ['auth'])
    state.denied = false
    state.calls = []
    await assert.rejects(wake({}), { statusCode: 503, data: { directoryUnavailable: true, approvalsUnavailable: false } })
    assert.deepEqual(new Set(state.calls), new Set(['auth', 'directory', 'approvals', 'due', 'dead']))
    assert.equal(state.calls[0], 'auth')
  } finally {
    hooks.deregister()
    delete globalThis.__peopleWakeChain
  }
})
