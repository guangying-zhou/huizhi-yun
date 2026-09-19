import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

// Only remote service/session boundaries are fixtures. H3 parsing, Aims input
// validation, product facts binding, scope evaluation and Host transport mapping
// below execute their production modules. This is not an OIDC/signature test.
test('real H3 project handoff enforces secondary permissions and filters candidates before paging', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false
  const calls = [], checks = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__planningSession = session
  globalThis.__planningTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: path.endsWith('/product-authorization')
      ? { product_code: options.body.productCode, actor_uid: session.uid, revision: 3, status: 'active', is_member: true, is_manager: false }
      : { receipt_id: 'receipt-fixture', scope_revision: 2 } } }
  }
  globalThis.__planningAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    const permission = `${required.resourceCode}:${required.action}`
    return { decision: { allowed: permission !== denied && required.object?.projectCode !== 'HIDDEN' }, grants: permission === denied ? [] : [{ grantId: 'explicit-person-grant', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'product', predicate: 'code', value: wrongScope ? 'P-B' : 'P-A' }] }] }
  }
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge') || specifier === './consoleSessionBridge') source = 'export const resolveConsoleAuthWithSessionBridge = async () => globalThis.__planningSession'
      if (specifier.endsWith('/tenantRuntimeClient') || specifier === './tenantRuntimeClient') source = 'export const maybeCallTenantRuntime = (...args) => globalThis.__planningTransport(...args); export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime = async () => true'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadScopedAuthorizationFromConsoleRuntime = (...args) => globalThis.__planningAuthorization(...args)'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })
  let server
  try {
    const projectFacts=code=>({project_id:code==='PRJ'?42:43,project_code:code,actor_uid:'person-a',department_code:'D',leader_uid:'person-a',created_by:'person-a',is_member:true})
    const originalTransport=globalThis.__planningTransport
    globalThis.__planningTransport=async(e,path,options)=>{
      if(path.endsWith('product-version:execution-coordination')){
        calls.push({path,options});const totals={target_count:1,incomplete_target_count:0,open_defect_count:0,total_weight:1,completed_weight:1,no_execution_plan:false}
        return {handled:true,data:{code:0,data:{...totals,target_count:2,total_weight:2,completed_weight:2,product_code:'P-A',version_id:1,workspace_revision:3,defect_coverage:'linked-descendants-only',projects:[{...totals,project_id:42},{...totals,project_id:43}]}}}
      }
      if(path.endsWith('product-version:execution-project-authorization')){
        calls.push({path,options});const id=options.body.input.project_id
        return {handled:true,data:{code:0,data:{id,project_code:id===42?'PRJ':'HIDDEN',dept_code:'D',leader_uid:'person-a',created_by:'person-a',members:[]}}}
      }
      if(!path.includes('/handoff:'))return originalTransport(e,path,options)
      calls.push({path,options});let data={value:{requirement_id:10}}
      if(path.endsWith('handoff:project-authorization'))data=projectFacts(options.body.input.project_code)
      if(path.endsWith('handoff:projects'))data=['PRJ','HIDDEN'].map(code=>({id:projectFacts(code).project_id,project_code:code,name:code,category:'product_dev',lifecycle_status:'active',facts:projectFacts(code)}))
      if(path.endsWith('handoff:requirements'))data={facts:projectFacts(options.body.input.project_code),items:[{id:10,project_id:projectFacts(options.body.input.project_code).project_id,title:'Existing',status:'draft'}]}
      return {handled:true,data:{code:0,data}}
    }
    const {enterpriseProductHandoffBridge:bridge}=await import('../server/utils/enterpriseProductHandoff.ts')
    const {enterpriseHandoffCandidates:candidates}=await import('../server/utils/enterpriseProductHandoffCandidates.ts')
    const {handleProductHandoff:handoff}=await import('../../aims/server/utils/productHandoffRuntime.ts')
    const {handleProductExecutionCoordination:execution}=await import('../../aims/server/utils/productExecutionCoordinationRuntime.ts')
    const {enterpriseProductPlanningBridge:planningBridge}=await import('../server/utils/enterpriseProductPlanning.ts')
    const app=createApp(),router=createRouter();app.use(defineEventHandler(e=>{e.context.consoleAuth=session}))
    router.post('/products/:productCode/planning-items/:itemId/handoffs',defineEventHandler(async e=>handoff(e,'planning',await bridge(e))))
    for(const action of ['projects','requirements'])router.get('/products/:productCode/handoff/'+action,defineEventHandler(e=>candidates(e,action)))
    router.get('/products/:productCode/roadmaps/execution-coordination',defineEventHandler(async e=>execution(e,await planningBridge(e))))
    app.use(router);server=createServer(toNodeListener(app));await new Promise(r=>server.listen(0,'127.0.0.1',r))
    const base=`http://127.0.0.1:${server.address().port}/products/P-A/`
    const item='00000000-0000-4000-8000-000000000001'
    const input={expectedRevision:3,expectedItemRevision:2,requestBizId:'00000000-0000-4000-8000-000000000002',expectedRequestRevision:2,projectCode:'PRJ',sliceKey:'one',operation:'create',title:'Login',scopeSummary:'Scope',reason:'Deliver',plannedVersionId:1,plannedVersionFeatureId:1}
    const post=async(body,key='handoff-key')=>fetch(base+'planning-items/'+item+'/handoffs',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)})
    for(const body of [{...input,tenant:'forged'},{...input,projectCode:''}])assert.equal((await post(body)).status,400)
    assert.equal((await post(input,'')).status,400)
    for(const permission of ['product_priorities:handoff','product_requests:handoff','product_versions:view','requirements:edit']){
      denied=permission;const before=calls.filter(c=>c.path.endsWith('handoff:create')).length
      assert.ok([403,404].includes((await post(input)).status),permission)
      assert.equal(calls.filter(c=>c.path.endsWith('handoff:create')).length,before)
    }
    denied='';assert.equal((await post(input)).status,200)
    const sent=calls.find(c=>c.path.endsWith('handoff:create'));assert.equal(sent.options.scope,'aims:product-priorities:handoff');assert.equal(sent.options.appCode,'enterprise');assert.equal(sent.options.idempotencyKey,'handoff-key');assert.equal(sent.options.body.project_authorization.action,'edit');assert.equal(sent.options.body.project_authorization.facts.actor_uid,'person-a')
    let response=await fetch(base+'handoff/projects?page=1&pageSize=1');assert.equal(response.status,200);let value=await response.json();assert.equal(value.data.total,1);assert.equal(value.data.items[0].project_code,'PRJ');assert.equal(value.data.items[0].facts,undefined)
    response=await fetch(base+'handoff/projects?page=2&pageSize=1');value=await response.json();assert.equal(value.data.total,1);assert.equal(value.data.items.length,0)
    assert.equal((await fetch(base+'handoff/requirements?projectCode=HIDDEN')).status,403)
    assert.equal((await fetch(base+'handoff/requirements?projectCode=PRJ')).status,200)
    assert.equal((await fetch(base+'handoff/projects?tenant=other')).status,400)
    response=await fetch(base+'roadmaps/execution-coordination?versionId=1');assert.equal(response.status,200);value=await response.json()
    assert.equal(value.data.total,1);assert.equal(value.data.projects.length,1);assert.equal(value.data.projects[0].project_id,42);assert.equal(value.data.restricted_project_count,1)
    denied='work_items:view';response=await fetch(base+'roadmaps/execution-coordination?versionId=1');assert.equal(response.status,200);value=await response.json();assert.equal(value.data.projects.length,0);denied=''

  }finally{
    if(server)await new Promise(r=>server.close(r));hooks.deregister();globalThis.useRuntimeConfig=oldConfig
    delete globalThis.__planningSession;delete globalThis.__planningTransport;delete globalThis.__planningAuthorization
  }
})
