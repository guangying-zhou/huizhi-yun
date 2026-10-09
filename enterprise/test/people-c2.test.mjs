import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

test('onboarding browser rejects server confirmations; manual candidates never call Console', async () => {
  const calls = []
  globalThis.__peopleC2 = calls
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>({expectedVersion:1,...globalThis.__peopleC2Action==='cancel'?{reason:'取消候选身份预留'}:{}});export const getHeader=()=> 'same-key';export const setHeader=()=>{}`
    if (s.endsWith('/directoryServiceCommand'))
      source = `export const callDirectoryServiceCommand=async()=>{globalThis.__peopleC2.push('target');throw Error('unexpected')};export const callDirectoryEmploymentStatus=async()=>{throw Error('unexpected')}`
    if (s === './enterprisePeopleFacts')
      source = `export const executePeopleFacts=async()=>({data:{data:{id:1,provider_code:'manual'}}})`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const m = await import('../server/utils/enterprisePeopleProvisioning.ts')
    for (const action of ['provision', 'activate', 'refresh-status', 'activation-link', 'cancel']) {
      globalThis.__peopleC2Action = action
      for (const key of ['confirmation', 'sourceApp', 'uid', 'operationKey', 'directoryApplied', 'approved'])
        assert.throws(() => m.normalizePeopleProvisioningBrowser(action, '1', { expectedVersion: 1, reason: '取消候选身份预留', [key]: true }), { statusCode: 400 })
      await assert.rejects(m.enterprisePeopleProvisioning({}, action), { statusCode: 409, message: '手工候选暂不支持自动开通，请在 Console 中处理' })
    }
    assert.deepEqual(calls, [])
  } finally {
    hooks.deregister()
    delete globalThis.__peopleC2
    delete globalThis.__peopleC2Action
  }
})
test('delivery is bounded, verified wake only and never retries source for Platform pending', () => {
  const s = readFileSync(new URL('../server/utils/enterprisePeopleDirectoryDelivery.ts', import.meta.url), 'utf8')
  for (const x of ['callEnterprisePeopleDirectoryWorker', 'validateServiceCommandReceipt', 'fencingToken', 'claimed < 1', 'page < 1', '25_000'])
    assert.ok(s.includes(x), x)
  assert.ok(s.indexOf('\'ack\'') > s.indexOf('} catch (error)'))
  assert.doesNotMatch(s, /setInterval|sourceApp:\s*'people'|platformStatus\s*!==\s*'succeeded'/)
})

test('provision resumes a lost response with original version offsets and frozen keys', async () => {
  const state = { version: 1, status: 'awaiting_profile', receipts: new Map(), targetKeys: [], lost: true }
  globalThis.__peopleC2Stages = state
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>({expectedVersion:1});export const getHeader=()=> 'same-key';export const setHeader=()=>{}`
    if (s.endsWith('/directoryServiceCommand'))
      source = `export const callDirectoryServiceCommand=async(_e,f)=>{const s=globalThis.__peopleC2Stages;s.targetKeys.push(f.operationKey);if(f.operationCode==='people.directory.identity-reserve.v1')return {uid:'candidate',reservationId:'reserve-1'};if(s.lost){s.lost=false;throw Object.assign(Error('lost response'),{statusCode:503})}return {uid:'candidate',operationId:'connector-op-1'}};export const callDirectoryEmploymentStatus=async()=>{throw Error('unexpected')}`
    if (s === './enterprisePeopleFacts')
      source = `export const executePeopleFacts=async(_e,op,i,key)=>{const s=globalThis.__peopleC2Stages;if(op==='onboarding-view')return {data:{data:{provider_code:'dingtalk',onboarding_code:'ONB-1',status:s.status,object_version:s.version}}};const intent=JSON.stringify(i.payload);const prior=s.receipts.get(key);if(prior){if(prior.intent!==intent)throw Error('changed replay intent');return prior.out}if(i.payload.expectedVersion!==s.version)throw Object.assign(Error('stale'),{statusCode:409});let data={};if(op.startsWith('onboarding-prepare-')){data={frozen:{sourceApp:'enterprise',targetApp:'console',operationKey:key,operationCode:op.endsWith('reserve')?'people.directory.identity-reserve.v1':'people.directory.user-provision.v1',command:{uid:'candidate',onboardingCode:'ONB-1'}}}}else{s.version++;s.status=op==='onboarding-provisioning'?'provisioning_account':'reserving_identity';data={status:s.status,object_version:s.version}}const out={data:{data}};s.receipts.set(key,{intent,out});return out}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { enterprisePeopleProvisioning } = await import('../server/utils/enterprisePeopleProvisioning.ts?stages')
    await assert.rejects(enterprisePeopleProvisioning({}, 'provision'), { statusCode: 503 })
    assert.equal(state.version, 3)
    const out = await enterprisePeopleProvisioning({}, 'provision')
    assert.equal(out.data.status, 'provisioning_account')
    assert.equal(state.version, 4)
    assert.deepEqual(state.targetKeys, ['same-key:prepare-reserve', 'same-key:prepare-provision', 'same-key:prepare-reserve', 'same-key:prepare-provision'])
    assert.equal(state.receipts.size, 5)
  } finally {
    hooks.deregister()
    delete globalThis.__peopleC2Stages
  }
})

test('diagnostics accept closed target facts only and never infer complete from partial success', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>({expectedVersion:1});export const getHeader=()=> 'same-key';export const setHeader=()=>{}`
    if (s.endsWith('/directoryServiceCommand'))
      source = `export const callDirectoryServiceCommand=async()=>{};export const callDirectoryEmploymentStatus=async()=>{}`
    if (s === './enterprisePeopleFacts')
      source = `export const executePeopleFacts=async()=>{}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { provisioningDiagnostic } = await import('../server/utils/enterprisePeopleProvisioning.ts?diagnostic')
    assert.deepEqual(provisioningDiagnostic('partial_unknown'), { provisionStatus: 'partial_unknown', directoryStatus: 'unknown', platformStatus: 'unknown' })
    assert.deepEqual(provisioningDiagnostic('succeeded', { directoryApplied: true, platformStatus: 'retry_wait', rawError: 'private-url' }), { provisionStatus: 'succeeded', directoryStatus: 'succeeded', platformStatus: 'retry_wait' })
    assert.throws(() => provisioningDiagnostic('private-error'), { statusCode: 502 })
    assert.throws(() => provisioningDiagnostic('succeeded', { directoryApplied: 'true', platformStatus: 'succeeded' }), { statusCode: 502 })
    assert.throws(() => provisioningDiagnostic('succeeded', { directoryApplied: true, platformStatus: 'private-error' }), { statusCode: 502 })
  } finally {
    hooks.deregister()
  }
})

test('cancel never confirms a release that the target has not acknowledged', async () => {
  const state = { confirmed: 0, released: false }
  globalThis.__peopleCancel = state
  const hooks = registerHooks({ resolve(s, c, next) {
    let source
    if (s === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>({expectedVersion:1,reason:'确认取消候选身份预留'});export const getHeader=()=> 'same-key';export const setHeader=()=>{}`
    if (s.endsWith('/directoryServiceCommand'))
      source = `export const callDirectoryServiceCommand=async()=>({uid:'candidate',reservationId:'reserve-1',released:globalThis.__peopleCancel.released});export const callDirectoryEmploymentStatus=async()=>{}`
    if (s === './enterprisePeopleFacts')
      source = `export const executePeopleFacts=async(_e,op)=>{if(op==='onboarding-view')return {data:{data:{provider_code:'dingtalk',onboarding_code:'ONB-1',has_reservation:1}}};if(op==='onboarding-prepare-release')return {data:{data:{frozen:{sourceApp:'enterprise',operationKey:'same-key',command:{uid:'candidate',onboardingCode:'ONB-1',reservationId:'reserve-1'}}}}};globalThis.__peopleCancel.confirmed++;return {data:{data:{status:'cancelled',object_version:2}}}}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { enterprisePeopleProvisioning } = await import('../server/utils/enterprisePeopleProvisioning.ts?cancel-confirmation')
    await assert.rejects(enterprisePeopleProvisioning({}, 'cancel'), { statusCode: 409 })
    assert.equal(state.confirmed, 0)
    state.released = true
    const result = await enterprisePeopleProvisioning({}, 'cancel')
    assert.equal(result.data.status, 'cancelled')
    assert.equal(state.confirmed, 1)
  } finally {
    hooks.deregister()
    delete globalThis.__peopleCancel
  }
})
