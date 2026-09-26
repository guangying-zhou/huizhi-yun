import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'

test('Enterprise association routes reject missing human permissions before Runtime issuance', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { product: true, documents: true, project: true, runtime: true, calls: [], prepared: [] }
  globalThis.__associationState = state
  globalThis.__associationUnavailable = createError({ statusCode: 503, message: 'authorization unavailable' })
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'person-a',tenant:'tenant-a',deployment:'enterprise-test'});
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000;
      export const prepareEnterpriseRuntime=async(_e,op)=>{globalThis.__associationState.prepared.push(op)};
      export const callEnterpriseRuntime=async(_e,op,body,options)=>{const s=globalThis.__associationState;s.calls.push({op,body,options});if(!s.runtime)throw globalThis.__associationUnavailable;
        if(op==='aims.product-document-link')return{code:0,data:{value:{product_code:body.productCode,document_uuid:body.input.document_uuid,purpose:body.input.purpose}}};
        if(op==='aims.project-products-link')return{code:0,data:{result:{projectId:Number(body.projectId),productCode:body.productCode}}};
        return{code:0,data:{items:[]}};
      }`
    if (specifier.endsWith('/productAuthorization')) source = `export const checkProductPermission=async(_e,_code,resource,action)=>({allowed:resource==='products'?globalThis.__associationState.product:globalThis.__associationState.documents,facts:{product_code:'P1',actor_uid:'person-a',revision:3}})`
    if (specifier.endsWith('/enterpriseProductAuthorization')) source = `export const enterpriseProductAuthorizationSource=async()=>({uid:'person-a'})`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=async()=>{const s=globalThis.__associationState;if(s.project==='down')throw globalThis.__associationUnavailable;return{decision:{allowed:s.project}}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'enterprise', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    router.add('/products/:productCode/roadmaps/documents', (await import('../server/routes/aims/api/v1/products/[productCode]/roadmaps/documents/index.post.ts')).default, 'post')
    router.add('/projects/:id/products', (await import('../server/routes/aims/api/v1/projects/[id]/products.get.ts')).default, 'get')
    router.add('/projects/:id/products', (await import('../server/routes/aims/api/v1/projects/[id]/products.post.ts')).default, 'post')
    const app = createApp(); app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${server.address().port}`
    const doc = { documentUuid: '11111111-1111-1111-1111-111111111111', purpose: 'requirements', expectedRevision: 3 }
    const request = async (path, body, key = 'key-1') => fetch(origin + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'Idempotency-Key': key } : {}, body: body && JSON.stringify(body) })
    const linked = await request('/products/P1/roadmaps/documents', doc)
    assert.equal(linked.status, 200, `${await linked.text()} ${JSON.stringify(state)}`)
    assert.equal(state.calls.at(-1).op, 'aims.product-document-link')
    assert.equal(state.calls.at(-1).body.authorization.action, 'edit')
    assert.equal(state.calls.at(-1).options.idempotencyKey, 'key-1')
    for (const [field, status] of [['product', 404], ['documents', 403]]) {
      const before = state.prepared.length
      state[field] = false
      assert.equal((await request('/products/P1/roadmaps/documents', doc)).status, status)
      assert.equal(state.prepared.length, before)
      state[field] = true
    }
    assert.equal((await request('/products/P1/roadmaps/documents', { ...doc, extra: true })).status, 400)
    assert.equal((await request('/products/P1/roadmaps/documents', doc, '')).status, 400)
    assert.equal((await request('/projects/1/products')).status, 200)
    assert.equal(state.calls.at(-1).op, 'aims.project-products-list')
    assert.equal((await request('/projects/1/products', { productCode: 'P1' })).status, 200)
    assert.equal(state.calls.at(-1).body.productAuthorization.action, 'view')
    for (const project of [false, 'down']) {
      const before = state.prepared.length
      state.project = project
      assert.equal((await request('/projects/1/products', { productCode: 'P1' })).status, project === false ? 403 : 503)
      assert.equal(state.prepared.length, before)
    }
    state.project = true
    state.product = false
    assert.equal((await request('/projects/1/products', { productCode: 'P1' })).status, 404)
    state.product = true
    state.runtime = false
    assert.equal((await request('/products/P1/roadmaps/documents', doc)).status, 503)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    hooks.deregister()
    delete globalThis.__associationState
    delete globalThis.__associationUnavailable
  }
})
