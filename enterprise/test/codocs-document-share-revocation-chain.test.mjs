import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Host share revocation blocks subsequent detail, content, and download reads', async () => {
  // Real Host routes/authorization adapters; Runtime ACL and OSS are isolated
  // fixtures. This proves reauthorization at the Host boundary, not live DB
  // share propagation, token issuance, or object-storage integration.
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const ossCalls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'user-b', tenant: 'tenant-a', deployment: 'enterprise-test' }
  let authorization = { resources: { documents: ['view', 'export'] }, actionPolicies: {} }
  let revoked = false
  const old = Object.fromEntries([
    'useRuntimeConfig', 'defineEventHandler', '__chainSession', '__chainAuth', '__chainTransport',
    '__chainPrepare', '__chainOss', '__chainRecovery'
  ].map(key => [key, globalThis[key]]))

  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__chainSession = session
  globalThis.__chainAuth = () => authorization
  globalThis.__chainPrepare = async () => true
  globalThis.__chainOss = async (...args) => {
    ossCalls.push(args)
    return '# shared content\n'
  }
  globalThis.__chainRecovery = async () => ''
  globalThis.__chainTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options, uid: session.uid })
    if (path.endsWith('document-shares:delete')) {
      assert.equal(session.uid, 'owner-a')
      revoked = true
      return { handled: true, data: { success: true, data: { changed: true } } }
    }
    if (path.endsWith('personal-documents:view') || path.endsWith('personal-documents:download')) {
      if (revoked && session.uid === 'user-b') {
        const error = new Error('share revoked')
        error.statusCode = 403
        throw error
      }
      return {
        handled: true,
        data: {
          success: true,
          data: { uuid: 'doc-1', oss_path: 'codocs/users/owner-a/doc-1.md', doc_type: 'private', title: 'Shared note' }
        }
      }
    }
    throw new Error(`unexpected runtime path: ${path}`)
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__chainSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__chainPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__chainTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__chainAuth()'
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
      if (specifier.endsWith('/oss')) source = 'export const downloadDocument=async(...args)=>globalThis.__chainOss(...args);export const downloadDocumentBuffer=async(...args)=>globalThis.__chainOss(...args)'
      if (specifier.endsWith('/yjsMarkdownRecovery')) source = 'export const hasMeaningfulMarkdownContent=value=>String(value??\'\').trim().length>0;export const recoverMarkdownFromYjsSnapshot=async(...args)=>globalThis.__chainRecovery(...args)'
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
    const app = createApp()
    const router = createRouter()
    router.get('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].get.ts')).default)
    router.get('/documents/:uuid/download', (await import('../server/routes/codocs/api/documents/[uuid]/download.get.ts')).default)
    router.delete('/documents/:uuid/shares/:shareId', (await import('../server/routes/codocs/api/documents/[uuid]/shares/[shareId].delete.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__chainSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    const beforeMetadata = await fetch(`${base}/documents/doc-1?skip_content=1`)
    assert.equal(beforeMetadata.status, 200)
    assert.equal((await beforeMetadata.json()).data.content, '')
    assert.equal(ossCalls.length, 0)
    const beforeDetail = await fetch(`${base}/documents/doc-1`)
    assert.equal(beforeDetail.status, 200)
    assert.match(await beforeDetail.text(), /shared content/)
    const beforeDownload = await fetch(`${base}/documents/doc-1/download`)
    assert.equal(beforeDownload.status, 200)
    assert.match(await beforeDownload.text(), /shared content/)
    const ossReadsBeforeRevoke = ossCalls.length
    assert.equal(ossReadsBeforeRevoke, 2)

    session.uid = 'owner-a'
    authorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
    const revoke = await fetch(`${base}/documents/doc-1/shares/7`, {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'revoke-chain-0001' }
    })
    assert.equal(revoke.status, 200)
    assert.ok(revoked)
    assert.equal(runtimeCalls.at(-1).path, '/v1/enterprise/codocs/document-shares:delete')

    session.uid = 'user-b'
    authorization = { resources: { documents: ['view', 'export'] }, actionPolicies: {} }
    const afterMetadata = await fetch(`${base}/documents/doc-1?skip_content=1`)
    assert.equal(afterMetadata.status, 403)
    const afterDetail = await fetch(`${base}/documents/doc-1`)
    assert.equal(afterDetail.status, 403)
    const afterDownload = await fetch(`${base}/documents/doc-1/download`)
    assert.equal(afterDownload.status, 403)
    assert.equal(ossCalls.length, ossReadsBeforeRevoke, 'revoked reads must not reach OSS')
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:view')).length, 4)
    assert.equal(runtimeCalls.filter(call => call.path.endsWith('personal-documents:download')).length, 2)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    for (const [key, value] of Object.entries(old)) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
})
