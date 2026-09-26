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
test('acceptance and publication preserve complete execution visibility through unified Host', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false, malformedProject = false, malformedHash = false
  const calls = [], checks = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__planningSession = session
  globalThis.__planningTransport = async (_event, path, options) => {
    calls.push({ path, options })
    let data = { receipt_id: 'receipt-fixture' }
    if (path.endsWith('/product-authorization')) data = { product_code: 'P-A', actor_uid: session.uid, revision: 3, status: 'active', is_member: true, is_manager: false }
    if (path.endsWith(':acceptance-preview')) data = { review_hash: malformedHash ? 'bad' : 'b'.repeat(64), execution: { targets: [{ project_id: 21, title: 'Restricted target' }], open_defects: [{ project_id: 21, title: 'Restricted defect' }] } }
    if (path.endsWith(':execution-project-authorization')) data = malformedProject ? {} : { id: 21, project_code: 'PR-21', created_by: 'person-a', dept_code: null, leader_uid: 'person-a', members: [] }
    return { handled: true, data: { code: 0, data } }
  }

  globalThis.__planningAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    const permission = `${required.resourceCode}:${required.action}`
    return { decision: { allowed: permission !== denied }, grants: permission === denied ? [] : [{ grantId: 'explicit-person-grant', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'product', predicate: 'code', value: wrongScope ? 'P-B' : 'P-A' }] }] }
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
    const router = createRouter(), app = createApp()
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    for (const [file,method,path] of [['acceptances.post.ts','post','accept'],['publish.post.ts','post','publish'],['acceptance-preview.get.ts','get','preview']]) {
      const handler = (await import(`../server/routes/aims/api/v1/products/[productCode]/versions/[versionId]/${file}`)).default
      router[method](`/products/:productCode/versions/:versionId/${path}`,handler)
    }
    app.use(router);server=createServer(toNodeListener(app));await new Promise(done=>server.listen(0,'127.0.0.1',done))
    const base=`http://127.0.0.1:${server.address().port}`
    const request=async(action,body)=>{const r=await fetch(`${base}/products/P-A/versions/12/${action}`,{method:action==='preview'?'GET':'POST',headers:{'content-type':'application/json','idempotency-key':'approval-command'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}}
    const inputs={accept:{expectedRevision:3,expectedVersionRevision:2,expectedScopeRevision:1,expectedReviewHash:'a'.repeat(64),checks:['execution-review','blocking-defects-review','release-readiness'].map(code=>({code,evidence:'Checked'})),exceptions:[]},publish:{expectedRevision:3,expectedVersionRevision:2,expectedScopeRevision:1,acceptanceId:9,reason:'Release'}}
    assert.equal((await request('accept',{...inputs.accept,checks:[]})).status,400)
    assert.equal((await request('publish',{...inputs.publish,acceptanceId:0})).status,400)
    for(const action of ['accept','publish']){
      const input=inputs[action]
      let before=calls.length;assert.equal((await request(action,{...input,execution_review_hash:'forged'})).status,400);assert.equal(calls.length,before)
      for(const permission of [`product_versions:${action}`,'product_versions:view','projects:view','work_items:view']){
        denied=permission;before=calls.filter(c=>c.path.endsWith(`:${action}`)).length
        assert.ok([403,404].includes((await request(action,input)).status),permission)
        assert.equal(calls.filter(c=>c.path.endsWith(`:${action}`)).length,before)
      }
      denied='';malformedProject=true;assert.equal((await request(action,input)).status,503);malformedProject=false
      malformedHash=true;assert.equal((await request(action,input)).status,503);malformedHash=false
      assert.equal((await request(action,input)).status,200)
      const command=calls.at(-1)
      assert.equal(command.path,`/v1/enterprise/aims/product-version:${action}`)
      assert.equal(command.options.body.execution_review_hash,'b'.repeat(64))
      assert.equal(command.options.scope,`aims:product-versions:${action}`)
      assert.equal(command.options.body.authorization.action,action)
      assert.equal(command.options.body.authorization.facts.actor_uid,'person-a')
      assert.equal(command.options.body.input.version_id,12)
      if(action==='accept')assert.equal(command.options.body.input.expected_review_hash,'a'.repeat(64))
      else assert.equal(command.options.body.input.acceptance_id,9)
    }
    denied='projects:view'
    const preview=await request('preview')
    assert.equal(preview.status,200)
    assert.deepEqual(preview.body.data.execution.targets,[])
    assert.deepEqual(preview.body.data.execution.open_defects,[])
    assert.equal(preview.body.data.execution.restricted_item_count,2)
    assert.equal(preview.body.data.review_hash,'b'.repeat(64))
    assert.ok(!JSON.stringify(preview.body).includes('Restricted target'))
    assert.ok(calls.every(c=>c.path.startsWith('/v1/enterprise/')),'no legacy Runtime IO')
  } finally {
    if(server)await new Promise(done=>server.close(done))
    hooks.deregister();globalThis.useRuntimeConfig=oldConfig
    delete globalThis.__planningSession;delete globalThis.__planningTransport;delete globalThis.__planningAuthorization
  }
})
