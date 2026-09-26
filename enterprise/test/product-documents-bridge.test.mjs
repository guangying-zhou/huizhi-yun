import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'

test('product document Host enforces product, document and Codocs read boundaries', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { product: true, documents: true, codocs: true, runtime: true, calls: [], prepared: [] }
  globalThis.__fe2State = state
  globalThis.__fe2Errors = { unavailable: createError({ statusCode: 503, message: 'down' }), denied: createError({ statusCode: 403, message: 'denied' }) }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'person-a',tenant:'tenant-a',deployment:'enterprise-test'});
      export const prepareEnterpriseRuntime=async(_event,op)=>{globalThis.__fe2State.prepared.push(op)};
      export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+10000;
      export const callEnterpriseRuntime=async(_event,op,body)=>{
        const s=globalThis.__fe2State;s.calls.push({op,body});
        if(!s.runtime)throw globalThis.__fe2Errors.unavailable;
        const common={product_code:body.productCode,workspace_revision:3};
        return op.endsWith('content')?{code:0,data:{...common,relation_biz_id:body.query.bizId,document:{uuid:'11111111-1111-1111-1111-111111111111',title:'Test',doc_type:'private',oss_path:'test/key'}}}:{code:0,data:{...common,items:[],total:0,page:1,pageSize:20}};
      }`
    if (specifier.endsWith('/productAuthorization')) source = `export const checkProductPermission=async(_event,_code,resource)=>({allowed:resource==='products'?globalThis.__fe2State.product:globalThis.__fe2State.documents,facts:{product_code:'P1',actor_uid:'person-a',revision:3}})`
    if (specifier.endsWith('/enterpriseProductAuthorization')) source = `export const enterpriseProductAuthorizationSource=async()=>({uid:'person-a'})`
    if (specifier.endsWith('/enterpriseCodocsDocumentContent')) source = `export const withEnterpriseCodocsDocumentContent=async(_event,response)=>{if(!globalThis.__fe2State.codocs)throw globalThis.__fe2Errors.denied;return{data:{...response.data,content:'visible'}}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp(), router = createRouter()
    const base = '../server/routes/aims/api/v1/products/[productCode]/roadmaps/'
    for (const [path, file] of [
      ['/documents', 'documents.get.ts'], ['/documents/requests', 'documents/requests.get.ts'],
      ['/documents/search', 'documents/search.get.ts'], ['/documents/content', 'documents/content.get.ts']
    ]) router.add('/products/:productCode/roadmaps' + path, (await import(base + file)).default, 'get')
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const origin = `http://127.0.0.1:${server.address().port}`
    const request = async suffix => { const response = await fetch(origin + '/products/P1/roadmaps/documents' + suffix); return { status: response.status, body: await response.json() } }
    const list = await request('?page=1')
    assert.equal(list.status, 200)
    assert.equal(state.calls.at(-1).op, 'aims.product-document-list')
    assert.equal(state.calls.at(-1).body.authorization.resource, 'product_documents')
    assert.equal(state.calls.at(-1).body.authorization.action, 'view')
    for (const [suffix, op] of [['/requests', 'aims.product-document-requests'], ['/search?search=Test', 'aims.product-document-search']]) {
      assert.equal((await request(suffix)).status, 200)
      assert.equal(state.calls.at(-1).op, op)
    }
    for (const [field, expected] of [['product', 404], ['documents', 403]]) {
      const before = state.calls.length, prepared = state.prepared.length
      state[field] = false
      assert.equal((await request('')).status, expected)
      assert.equal(state.calls.length, before)
      assert.equal(state.prepared.length, prepared)
      state[field] = true
    }
    state.runtime = false
    assert.equal((await request('')).status, 503)
    state.runtime = true
    const content = '/content?bizId=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    state.codocs = false
    const deniedBody = await request(content)
    assert.equal(deniedBody.status, 403, JSON.stringify(deniedBody.body))
    state.codocs = true
    const visible = await request(content)
    assert.equal(visible.status, 200)
    assert.equal(visible.body.data.content, 'visible')
    assert.equal('oss_path' in visible.body.data, false)
    assert.equal((await request('/content?bizId=../secret')).status, 400)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)) }
    hooks.deregister()
    delete globalThis.__fe2State
    delete globalThis.__fe2Errors
  }
})
