import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
test('knowledge summaries hide denied counts and retain server pagination; writes associate existing UUID only', () => {
  const source = read('enterprise/app/components/AltocKnowledgePanel.vue')
  const { descriptor } = parse(source)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'AltocKnowledgePanel.vue', id: 'knowledge' }).errors, [])
  compileScript(descriptor, { id: 'knowledge' })
  assert.match(source, /state\?\.access === 'denied'/)
  assert.match(source, /state\?\.access === 'allowed'/)
  assert.match(source, /共 \{\{ state.total \}\} 条/)
  assert.match(source, /UPagination/)
  assert.match(source, /:loading="pending"/)
  assert.match(source, /已有文档 UUID/)
  assert.match(source, /linkIntent/)
  assert.match(source, /resumeIntent/)
  assert.match(source, /expectedVersion: props.rowVersion/)
  assert.match(source, /Idempotency-Key/)
  assert.doesNotMatch(source, /upload|publish|markdown/i)
})
test('knowledge transport uses frozen exact targets, fresh tokens and target receipts before checkpoint', () => {
  const source = read('enterprise/server/utils/enterpriseAltocKnowledge.ts')
  assert.match(source, /assets:asset-link:create/)
  assert.match(source, /codocs:knowledge-link:create/)
  assert.match(source, /requestWithServiceAccessToken/)
  assert.match(source, /validateServiceCommandReceipt/)
  assert.match(source, /command.targetDeployment !== route.deploymentCode/)
  assert.match(source, /command.actorUid !== user.uid/)
  assert.match(source, /Object.keys\(raw\).some/)
  assert.match(source, /checkpoint: JSON.stringify\(receipts\)/)
  assert.ok(source.indexOf('validateServiceCommandReceipt(envelope') < source.indexOf('checkpoint: JSON.stringify(receipts)'))
  assert.doesNotMatch(source, /assets:write|codocs:write|sourceApp: 'altoc'/)
  const contract = read('foundation/server/utils/knowledgeLinkService.ts')
  assert.match(contract, /requireConsoleAuthContext/)
  assert.match(contract, /verifyServiceCommandRuntimeHeaders/)
  assert.match(contract, /canonicalKnowledgeCommand/)
  assert.match(read('assets/server/utils/enterpriseKnowledgeLinkService.ts'), /knowledge_link_deliveries/)
  assert.match(read('console/server/utils/subjectScopedAuthorizationContract.ts'), /knowledge_link_deliveries/)
})

test('real knowledge Host bridge rejects browser authority and completes only verified fresh target calls', async () => {
  const { registerHooks } = await import('node:module')
  const cmd = { actorUid: 'Person', action: 'link', ticketCode: 'T', documentUuid: '00000000-0000-4000-8000-000000000001', customerCode: 'C', contractCode: 'CT', projectCode: 'P', deliveryCode: 'D', deliveryAssetCode: 'A', environmentCode: 'E', targetDeployment: 'assets-test' }
  globalThis.__knowledge = { body: { documentUuid: cmd.documentUuid, expectedVersion: 1 }, query: {}, calls: [], requests: [], allowed: true }
  const state = globalThis.__knowledge
  state.frozen = ['assets', 'codocs'].map(target => ({ operationId: `00000000-0000-4000-8000-00000000000${target === 'assets' ? 2 : 3}`, operationCode: `enterprise.${target}.knowledge-link.v1`, targetApp: target, requiredCapability: target === 'assets' ? 'assets:asset-link:create' : 'codocs:knowledge-link:create', idempotencyKey: `original:${target}`, commandSchemaVersion: 'v1', commandSha256: 'a'.repeat(64), command: { ...cmd, targetDeployment: `${target}-test` } }))
  const hooks = registerHooks({ resolve(s, c, next) {
    let code
    if (s === 'h3')
      code = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__knowledge.query;export const getRouterParam=()=> '1';export const readBody=async()=>globalThis.__knowledge.body;export const setHeader=()=>{}`
    if (s.endsWith('/enterpriseRuntimeClient'))
      code = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'enterprise-test'});export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(e,op,input,options)=>{const s=globalThis.__knowledge;s.calls.push({op,input,options});return{code:0,data:input.sales.payload.checkpoint?{id:'1'}:{id:'1',frozen:structuredClone(s.frozen)}}}`
    if (s === './enterpriseAPF')
      code = `export const buildAPFPermit=async()=>{if(!globalThis.__knowledge.allowed)throw Object.assign(Error('denied'),{statusCode:403});return{allowed:true}}`
    if (s.endsWith('/platformBundleAuthorization'))
      code = `export const loadScopedAuthorizationFromConsoleRuntime=async()=>({grants:[]})`
    if (s.endsWith('/assetsScopedAuthorizationCore'))
      code = `export const assetsObjectScopeFromScopedAuthorization=()=>({access:'all'});export const assetsObjectScopeQuery=()=>({current_user_assets_object_access:'all'})`
    if (s.endsWith('/serviceAppUrl'))
      code = `export const resolveTrustedServiceAppRoute=(e,app)=>({baseUrl:'http://'+app+'.local/'+app,deploymentCode:app+'-test'})`
    if (s.endsWith('/directoryApi'))
      code = `export const fetchConsoleDirectoryApi=async()=>{throw Error('not used')}`
    if (s.endsWith('/altocDataAccessScope'))
      code = `export const buildAltocDepartmentTreeCodeIndex=()=>({})`
    if (s.endsWith('/crossAppForwardedHeaders'))
      code = `export const crossAppForwardedHeaders=()=>({'trusted-context':'verified'})`
    if (s.endsWith('/serviceOidc'))
      code = `export const requestWithServiceAccessToken=async x=>{globalThis.__knowledge.requests.push(x.scope);return x.request('fresh:'+x.audience)}`
    if (s.endsWith('/tenantRuntimeClient'))
      code = `export const buildServiceCommandRuntimeHeaders=async x=>({'target-signature':x.targetApp})`
    if (s.endsWith('/appServiceBinding'))
      code = `export const serviceAppFetch=async(e,app,url,options)=>{globalThis.__knowledge.requests.push({app,url,options});return{code:0,data:{operationId:options.body.serviceCommand.operationId,receiptId:'receipt'}}}`
    if (s.endsWith('/serviceOperation'))
      code = `export const validateServiceCommandReceipt=(env,r)=>{if(env.operationId!==r.operationId)throw Object.assign(Error('bad receipt'),{statusCode:409})}`
    if (s.endsWith('/knowledgeLinkContract'))
      return { url: new URL('../../foundation/server/utils/knowledgeLinkContract.ts', import.meta.url).href, shortCircuit: true }
    if (code)
      return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true }
    return next(s, c)
  } })
  try {
    const { enterpriseAltocKnowledge } = await import('../server/utils/enterpriseAltocKnowledge.ts')
    const result = await enterpriseAltocKnowledge({}, 'service-ticket-knowledge-link')
    assert.deepEqual(result, { code: 0, data: { id: '1', status: 'linked' } })
    assert.deepEqual(state.requests.filter(x => typeof x === 'string'), ['assets:asset-link:create', 'codocs:knowledge-link:create'])
    for (const request of state.requests.filter(x => typeof x === 'object')) {
      assert.equal(request.options.headers.authorization, `Bearer fresh:${request.app}`)
      assert.equal(request.options.body.serviceCommand.idempotencyKey, `original:${request.app}`)
      assert.equal(request.options.headers['target-signature'], request.app)
    }
    assert.equal(state.calls.length, 2)
    assert.equal(state.calls[0].input.sales.payload.assetsDeployment, 'assets-test')
    assert.equal(JSON.parse(state.calls[1].input.sales.payload.checkpoint).length, 2)
    state.body = { checkpoint: 'forged' }
    await assert.rejects(enterpriseAltocKnowledge({}, 'service-ticket-knowledge-resume'), { statusCode: 400 })
    assert.equal(state.calls.length, 2)
    state.body = { documentUuid: cmd.documentUuid, expectedVersion: 1 }
    state.allowed = false
    await assert.rejects(enterpriseAltocKnowledge({}, 'service-ticket-knowledge-link'), { statusCode: 403 })
    assert.equal(state.calls.length, 2)
  } finally {
    hooks.deregister()
    delete globalThis.__knowledge
  }
})
