import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

test('server-derived UUID uses the existing actor-bound Codocs view and refuses independently', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const uuid = '11111111-1111-4111-8111-111111111111'
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser=async()=>({uid:'member',tenant:'tenant-a',deployment:'enterprise-a'});
      export const prepareEnterpriseRuntime=async(...args)=>globalThis.__codocsInternalPrepare(...args);
      export const enterpriseRuntimePermitExpiresAt=()=> 'fixture-expiry';
      export const callEnterpriseRuntime=async(...args)=>globalThis.__codocsInternalRuntime(...args);`
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async(uid,app)=>{globalThis.__codocsInternalPolicyApps.push(app);return {resources:globalThis.__codocsInternalAllowed?{documents:["view"]}:{},actionPolicies:{}}}'
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true'
    if (specifier === './enterpriseCodocsDocumentContent') source = 'export const withEnterpriseCodocsDocumentContent=async(event,result,uuid,skip)=>globalThis.__codocsInternalContent(result,uuid,skip)'
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  let server
  try {
    globalThis.__codocsInternalAllowed = true
    globalThis.__codocsInternalPolicyApps = []
    globalThis.__codocsInternalPrepare = async (_event, operation) => calls.push(['prepare', operation])
    globalThis.__codocsInternalRuntime = async (_event, operation, input) => {
      calls.push(['runtime', operation, input])
      return { success: true, data: { uuid: input.code } }
    }
    globalThis.__codocsInternalContent = async (result, code, skip) => {
      calls.push(['content', code, skip])
      return result
    }
    const { enterpriseCodocsDocumentRead, enterpriseCodocsDocumentViewByUuid } = await import('../server/utils/enterpriseCodocsDocumentReads.ts')
    const app = createApp(), router = createRouter()
    router.get('/internal/:uuid', defineEventHandler(event => enterpriseCodocsDocumentViewByUuid(event, uuid)))
    router.get('/metadata/:uuid', defineEventHandler(event => enterpriseCodocsDocumentViewByUuid(event, uuid, true)))
    router.get('/ordinary/:uuid', defineEventHandler(event => enterpriseCodocsDocumentRead(event, 'view')))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    assert.equal((await fetch(base + '/internal/browser-supplied-other')).status, 200)
    assert.deepEqual(globalThis.__codocsInternalPolicyApps, ['codocs'])
    const input = calls.find(row => row[0] === 'runtime')[2]
    assert.equal(input.code, uuid)
    assert.equal(input.authorization.actorUid, 'member')
    assert.equal(input.authorization.resource, 'personal-documents')
    assert.equal(input.authorization.action, 'read')
    assert.equal(calls.find(row => row[0] === 'runtime')[1], 'codocs.personal-document-view')
    assert.deepEqual(calls.at(-1), ['content', uuid, false])
    assert.equal((await fetch(base + '/metadata/other')).status, 200)
    assert.deepEqual(calls.at(-1), ['content', uuid, true])
    assert.equal((await fetch(base + '/ordinary/legacy-code?skip_content=1')).status, 200)
    assert.deepEqual(calls.at(-1), ['content', 'legacy-code', true])

    calls.length = 0
    globalThis.__codocsInternalAllowed = false
    assert.equal((await fetch(base + '/internal/other')).status, 403)
    assert.equal(calls.some(row => row[0] === 'runtime' || row[0] === 'content'), false)
    globalThis.__codocsInternalAllowed = true
    for (const statusCode of [403, 404]) {
      calls.length = 0
      globalThis.__codocsInternalRuntime = async () => {
        throw Object.assign(new Error('fixture ACL denial'), { statusCode })
      }
      assert.equal((await fetch(base + '/internal/other')).status, statusCode)
      assert.equal(calls.some(row => row[0] === 'content'), false)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const name of ['Allowed', 'PolicyApps', 'Prepare', 'Runtime', 'Content']) delete globalThis['__codocsInternal' + name]
  }
})
