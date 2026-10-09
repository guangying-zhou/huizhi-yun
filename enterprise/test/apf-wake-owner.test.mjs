import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

test('People wake runs both independent queues, preserves dependency 503 and returns only fixed failure facts', async () => {
  globalThis.__apfWake = { calls: [], failure: '' }
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3')
      source = `export const defineEventHandler=f=>f;export const readBody=async e=>e.body;export const createError=x=>Object.assign(Error(x.statusMessage||'fixed'),x)`
    if (s.endsWith('/enterpriseRuntimeChannels'))
      source = `export const callEnterpriseAPFScheduler=async(e,d)=>{globalThis.__apfWake.calls.push('inspect:'+d);return {code:0}}`
    if (s.endsWith('/enterpriseAPFDeadLetterDelivery'))
      source = `export const drainEnterpriseAPFDeadLetter=async()=>({disabled:true})`
    if (s.endsWith('/enterpriseAPFDueDelivery'))
      source = `export const drainEnterpriseAPFDue=async()=>({disabled:true})`
    if (s.endsWith('/enterprisePeopleDirectoryDelivery'))
      source = `export const drainEnterprisePeopleDirectory=async()=>{const s=globalThis.__apfWake;s.calls.push('directory');if(s.failure==='directory')throw Error('private dependency detail');return {delivered:1}}`
    if (s.endsWith('/enterprisePeopleWorkflow'))
      source = `export const resumePeopleAssignmentApprovals=async()=>{const s=globalThis.__apfWake;s.calls.push('approval');if(s.failure==='approval')throw Error('private dependency detail');return {resumed:1}}`
    if (s.endsWith('/enterpriseAltocApproval'))
      source = `export const resumeAltocApprovals=async()=>({bound:1})`
    if (s.endsWith('/enterpriseFinanceApproval'))
      source = `export const resumeFinanceApprovals=async()=>({bound:1})`
    return source ? { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true } : next(s, c)
  } })
  try {
    const { default: wake } = await import('../server/routes/enterprise/api/internal/apf/scheduler-inspect.post.ts')
    for (const failure of ['directory', 'approval']) {
      globalThis.__apfWake.failure = failure
      globalThis.__apfWake.calls = []
      await assert.rejects(wake({ body: { domain: 'people' } }), (e) => {
        assert.equal(e.statusCode, 503)
        assert.equal(e.message, 'apf_people_wake_unavailable')
        assert.deepEqual(e.data, { directoryUnavailable: failure === 'directory', approvalsUnavailable: failure === 'approval' })
        return true
      })
      assert.deepEqual(globalThis.__apfWake.calls, ['inspect:people', 'directory', 'approval'])
    }
    globalThis.__apfWake.failure = ''
    assert.deepEqual(await wake({ body: { domain: 'people' } }), { code: 0, dueNotifications: { disabled: true }, deadLetterNotifications: { disabled: true }, directoryLifecycle: { delivered: 1 }, approvals: { resumed: 1 } })
    await assert.rejects(wake({ body: { domain: 'people', actor: 'forged' } }), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__apfWake
  }
})
