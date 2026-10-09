import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
test('feedback freezes source and user recovery never accepts product, actor, decision or extra evidence', async () => {
  const s = globalThis.__feedback = { body: { expectedSourceSha256: 'a'.repeat(64) }, calls: [], allowed: true, productAllowed: true, result: 'pending' }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let code
    if (specifier === 'h3')
      code = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>({});export const getRouterParam=()=> '1';export const readBody=async()=>globalThis.__feedback.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      code = `export const requireEnterpriseUser=async()=>({uid:'person',tenant:'C000001',deployment:'host'});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(e,op,body,options)=>{globalThis.__feedback.calls.push({op,body,options});return{code:0,data:{submitted:!op.endsWith('-view'),productCode:'P',status:op.endsWith('-resume')?'succeeded':globalThis.__feedback.result,private:'must-not-leak'}}}`
    if (specifier === './enterpriseAPF')
      code = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__feedback.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return{resource:r,action:a,allowed:true}}`
    if (specifier === './enterpriseProductAuthorization')
      code = `export const requireEnterpriseProductPermission=async(e,code,action)=>{if(!globalThis.__feedback.productAllowed)throw Object.assign(Error('fixed'),{statusCode:403});return{authorization:{resource:'product_requests',action,facts:{product_code:code,actor_uid:'person'},expires_at:123}}}`
    return code ? { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true } : next(specifier, context)
  } })
  try {
    const { enterpriseAltocFeedback } = await import('../server/utils/enterpriseAltocFeedback.ts')
    const result = await enterpriseAltocFeedback({}, 'submit')
    assert.equal(result.data.status, 'succeeded')
    assert.equal('private' in result.data, false)
    assert.deepEqual(s.calls.map(c => c.op), ['altoc.apf16f-product-feedback-view', 'altoc.apf16f-product-feedback-submit', 'altoc.apf16f-product-feedback-resume'])
    assert.equal(s.calls[1].body.authorization.resource, 'service_ticket')
    assert.equal(s.calls[1].body.authorization.action, 'edit')
    assert.equal(JSON.parse(s.calls[1].body.sales.payload.productAuthorization).resource, 'product_requests')
    for (const field of ['productCode', 'actorUid', 'decisionStatus', 'evidence', 'serviceCommand']) {
      s.body = { expectedSourceSha256: 'a'.repeat(64), [field]: 'forged' }
      await assert.rejects(enterpriseAltocFeedback({}, 'submit'), { statusCode: 400 })
    }
    s.body = {}
    await enterpriseAltocFeedback({}, 'resume')
    assert.equal(s.calls.at(-1).op, 'altoc.apf16f-product-feedback-resume')
    s.productAllowed = false
    const before = s.calls.length
    await assert.rejects(enterpriseAltocFeedback({}, 'resume'), { statusCode: 403 })
    assert.equal(s.calls.length, before + 1)
    s.allowed = false
    await assert.rejects(enterpriseAltocFeedback({}, 'view'), { statusCode: 403 })
  } finally {
    hooks.deregister()
    delete globalThis.__feedback
  }
})
test('feedback service authenticates old Aims contract before fresh S hop and rejects forged binding/header', async () => {
  const state = globalThis.__feedbackService = { auth: { authenticated: true, appCode: 'aims', clientCode: 'aims.runtime', tenant: 'C000001', deployment: 'aims-test', scopes: ['altoc:product-feedback:update-status'] }, gateway: { tenant: 'C000001', appCode: 'enterprise', deployment: 'enterprise-test' }, signature: true, calls: [], body: { serviceCommand: { targetApp: 'altoc', operationId: 'operation', operationCode: 'aims.altoc.product-feedback.update-status.v1', requiredCapability: 'altoc:product-feedback:update-status', commandSchemaVersion: 'product-feedback-status.v1', commandSha256: 'hash', idempotencyKey: 'original', command: { ticketCode: 'ST-1' } } } }
  const hooks = registerHooks({ resolve(s, c, next) {
    let code
    if (s === 'h3')
      code = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=(e,n)=>n==='authorization'?'Bearer incoming-old-token':'request';export const getQuery=()=>({});export const getRequestURL=()=>({pathname:'/altoc/api/v1/service/product-feedback/status'});export const readBody=async()=>globalThis.__feedbackService.body;export const setHeader=()=>{}`
    if (s.endsWith('/consoleOidc'))
      code = `export const requireConsoleAltocServiceAuth=async()=>globalThis.__feedbackService.auth`
    if (s.endsWith('/tenantGatewayTrust'))
      code = `export const resolveTrustedTenantGatewayContext=()=>globalThis.__feedbackService.gateway`
    if (s.endsWith('/serviceAppUrl'))
      code = `export const resolveTrustedServiceAppRoute=(e,a)=>({deploymentCode:a+'-test'})`
    if (s.endsWith('/tenantRuntimeClient'))
      code = `export const hashServiceCommandPayload=async()=> 'hash';export const verifyServiceCommandRuntimeHeaders=async x=>{if(!globalThis.__feedbackService.signature)throw Object.assign(Error('fixed'),{statusCode:403});globalThis.__feedbackService.calls.push({signature:x})}`
    if (s.endsWith('/enterpriseRuntimeChannels'))
      code = `export const callEnterpriseAltocFeedbackProjection=async(e,k,b)=>{globalThis.__feedbackService.calls.push({kind:k,body:b});return{code:0,data:{receiptStatus:'succeeded',operationId:b.OperationID,commandSha256:b.CommandSHA256}}}`
    return code ? { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true } : next(s, c)
  } })
  try {
    const { enterpriseAltocFeedbackService } = await import('../server/utils/enterpriseAltocFeedbackService.ts')
    await enterpriseAltocFeedbackService({ method: 'POST' }, 'status')
    assert.equal(state.calls.at(-1).body.TrustedContext.SourceApp, 'aims')
    assert.equal(JSON.stringify(state.calls.at(-1)).includes('incoming-old-token'), false)
    const base = structuredClone(state.auth)
    for (const change of [{ appCode: 'enterprise' }, { clientCode: 'other.runtime' }, { tenant: 'other' }, { deployment: 'other' }, { scopes: [] }]) {
      state.auth = { ...base, ...change }
      await assert.rejects(enterpriseAltocFeedbackService({ method: 'POST' }, 'status'), { statusCode: 403 })
    }
    state.auth = base
    state.signature = false
    await assert.rejects(enterpriseAltocFeedbackService({ method: 'POST' }, 'status'), { statusCode: 403 })
    state.signature = true
    state.gateway.deployment = 'other'
    await assert.rejects(enterpriseAltocFeedbackService({ method: 'POST' }, 'status'), { statusCode: 403 })
  } finally {
    hooks.deregister()
    delete globalThis.__feedbackService
  }
})
test('feedback UI exposes original recovery and readonly assessment/progress without evidence or decision writes', () => {
  const s = read('enterprise/app/components/AltocProductFeedbackPanel.vue')
  const { descriptor } = parse(s)
  compileScript(descriptor, { id: 'feedback' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'Feedback.vue', id: 'feedback' }).errors, [])
  assert.match(s, /恢复原反馈/)
  assert.match(s, /progressPending/)
  assert.match(s, /decisionStatus === 'rejected'/)
  assert.match(s, /createConsoleMutationIntent/)
  assert.match(s, /useConfirm/)
  assert.doesNotMatch(s, /onApproved|evidence\s*:|decisionStatus\s*:|<UInput|<UTextarea/)
  const pc = read('data-runtime/internal/enterpriseapf/altoc_feedback.go')
  assert.match(pc, /ReceiveFeedbackRequestTx/)
  assert.match(pc, /BeginWriteTransaction/)
  assert.match(pc, /ApplyProductFeedbackStatusTx/)
  assert.match(pc, /ApplyProductFeedbackProgressTx/)
  const source = read('data-runtime/internal/enterprise/outbound_source.go')
  assert.match(source, /aims\.runtime/)
  assert.match(source, /workerClient != "aims\.runtime" && workerClient != "enterprise\.runtime"/)
  assert.match(source, /RetireAPFCommands: s\.workerClient == "enterprise\.runtime"/)
})
test('actual Foundation receiver hop reacquires Enterprise S identity and never forwards inbound bearer', async () => {
  const calls = []
  globalThis.__feedbackHop = { calls, handled: true }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error('fixed'),x)`
    if (specifier === './tenantGatewayTrust')
      source = `export const requireTenantGatewaySchedulerRequest=()=>{throw Error('not a wake')}`
    if (specifier === './tenantRuntimeClient')
      source = `export const maybeCallTenantRuntime=async(e,p,o)=>{globalThis.__feedbackHop.calls.push({p,o});return {handled:globalThis.__feedbackHop.handled,data:{code:0}}}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  const caller = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'aims', clientCode: 'aims.runtime', scopes: ['altoc:product-feedback:update-status'] }
  try {
    const { callEnterpriseAltocFeedbackProjection } = await import('../../foundation/server/utils/enterpriseRuntimeChannels.ts')
    await callEnterpriseAltocFeedbackProjection({ context: { consoleAuth: caller }, headers: { authorization: 'Bearer inbound-not-forwarded' } }, 'status', { marker: 'closed command' })
    assert.equal(calls[0].p, '/v1/enterprise/altoc/product-feedback-status')
    assert.equal(calls[0].o.channel, 'system')
    assert.equal(calls[0].o.appCode, 'enterprise')
    assert.equal(calls[0].o.scope, 'altoc:scheduler:execute')
    assert.equal(calls[0].o.serviceTokenSourceBinding, 'service-client-policy')
    assert.ok(!JSON.stringify(calls).includes('inbound-not-forwarded'))
    for (const bad of [{ authenticated: false }, { tokenUse: 'access' }, { subjectType: 'user' }, { appCode: 'altoc' }, { clientCode: 'enterprise.runtime' }, { scopes: ['altoc:*'] }])
      await assert.rejects(callEnterpriseAltocFeedbackProjection({ context: { consoleAuth: { ...caller, ...bad } } }, 'status', {}), { statusCode: 403 })
    await assert.rejects(callEnterpriseAltocFeedbackProjection({ context: { consoleAuth: caller } }, 'other', {}), { statusCode: 403 })
    assert.equal(calls.length, 1)
    globalThis.__feedbackHop.handled = false
    await assert.rejects(callEnterpriseAltocFeedbackProjection({ context: { consoleAuth: caller } }, 'status', {}), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__feedbackHop
  }
})
