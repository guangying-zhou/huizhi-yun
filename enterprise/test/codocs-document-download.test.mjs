import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs document download enforces export permits and returns safe markdown attachment', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const preparations = []
  const ossCalls = []
  const auditCalls = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsDownloadSession
  const oldAuth = globalThis.__codocsDownloadAuthorization
  const oldAuthError = globalThis.__codocsDownloadAuthorizationError
  const oldTransport = globalThis.__codocsDownloadTransport
  const oldPrepare = globalThis.__codocsDownloadPrepare
  const oldOss = globalThis.__codocsDownloadOss
  const oldRecovery = globalThis.__codocsDownloadRecovery
  const oldAudit = globalThis.__codocsDownloadAudit

  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsDownloadSession = session
  globalThis.__codocsDownloadAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }
  globalThis.__codocsDownloadAuthorizationError = null
  globalThis.__codocsDownloadPrepare = async (_event, options) => { preparations.push(options); return true }
  globalThis.__codocsDownloadTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options })
    return {
      handled: true,
      data: {
        success: true,
        data: {
          uuid: 'doc-1',
          oss_path: 'codocs/company/doc-1.md',
          doc_type: 'private',
          title: '财务/报告\r\n'
        }
      }
    }
  }
  globalThis.__codocsDownloadOss = async (...args) => {
    ossCalls.push(args)
    return '# exported markdown\n'
  }
  globalThis.__codocsDownloadRecovery = async () => ''
  globalThis.__codocsDownloadAudit = async (...args) => { auditCalls.push(args) }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/oss')) source = 'export const downloadDocument=async(...args)=>globalThis.__codocsDownloadOss(...args);export const downloadDocumentBuffer=async(...args)=>globalThis.__codocsDownloadOss(...args)'
      if (specifier.endsWith('/yjsMarkdownRecovery')) source = 'export const hasMeaningfulMarkdownContent=value=>String(value??\'\').trim().length>0;export const recoverMarkdownFromYjsSnapshot=async(...args)=>globalThis.__codocsDownloadRecovery(...args)'
      if (specifier.endsWith('/enterpriseCodocsDocumentAccessRecord')) source = 'export const recordEnterpriseCodocsDocumentAccess=async(...args)=>globalThis.__codocsDownloadAudit(...args)'
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsDownloadSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsDownloadPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsDownloadTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>{if(globalThis.__codocsDownloadAuthorizationError) throw globalThis.__codocsDownloadAuthorizationError;return globalThis.__codocsDownloadAuthorization}'
      if (specifier.endsWith('/tenantGatewayTrust')) source = 'export const resolveTrustedTenantGatewayContext=()=>undefined'
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
    router.get('/documents/:uuid/download', (await import('../server/routes/codocs/api/documents/[uuid]/download.get.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsDownloadSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${base}/documents/doc-1/download`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '# exported markdown\n')
    assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8')
    const disposition = response.headers.get('content-disposition')
    assert.match(disposition, /attachment; filename="/)
    assert.match(disposition, /filename\*=UTF-8''/)
    assert.ok(!disposition.includes('/') && !disposition.includes('\\') && !disposition.includes('\r') && !disposition.includes('\n'))
    assert.match(decodeURIComponent(disposition), /财务_报告__.md/)
    assert.equal(ossCalls.length, 1)
    assert.equal(ossCalls[0][0], 'codocs/company/doc-1.md')
    assert.equal(ossCalls[0][1], 'private')
    assert.ok(ossCalls[0][2].event)
    assert.equal(runtimeCalls[0].path, '/v1/enterprise/codocs/personal-documents:download')
    assert.equal(runtimeCalls[0].options.scope, 'codocs:personal-documents:export')
    assert.equal(runtimeCalls[0].options.body.authorization.action, 'export')
    assert.equal(runtimeCalls[0].options.body.authorization.actorUid, 'person-a')
    assert.equal(preparations.at(-1).scope, 'codocs:personal-documents:export')
    assert.equal(preparations.at(-1).method, 'POST')
    assert.equal(runtimeCalls[0].options.body.code, 'doc-1')
    assert.deepEqual(auditCalls[0].slice(1), ['doc-1', 'codocs/company/doc-1.md', 'export'])

    globalThis.__codocsDownloadAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    const beforeViewOnlyRuntime = runtimeCalls.length
    const beforeViewOnlyOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents/doc-1/download`)).status, 403)
    assert.equal(runtimeCalls.length, beforeViewOnlyRuntime)
    assert.equal(ossCalls.length, beforeViewOnlyOss)
    globalThis.__codocsDownloadAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }

    globalThis.__codocsDownloadAuthorizationError = { statusCode: 409, statusMessage: 'ACL backend exact', message: 'ACL backend exact' }
    const aclResponse = await fetch(`${base}/documents/doc-1/download`)
    assert.equal(aclResponse.status, 409)
    assert.doesNotMatch(await aclResponse.text(), /secret storage endpoint/)
    assert.equal(ossCalls.length, beforeViewOnlyOss)
    globalThis.__codocsDownloadAuthorizationError = null

    const beforeQueryRuntime = runtimeCalls.length
    assert.equal((await fetch(`${base}/documents/doc-1/download?raw=1`)).status, 400)
    assert.equal(runtimeCalls.length, beforeQueryRuntime)

    globalThis.__codocsDownloadTransport = async () => ({
      handled: true,
      data: { success: true, data: { uuid: 'other-doc', oss_path: 'codocs/private/other.md', doc_type: 'private', title: 'Wrong' } }
    })
    const beforeMismatchOss = ossCalls.length
    assert.equal((await fetch(`${base}/documents/doc-1/download`)).status, 503)
    assert.equal(ossCalls.length, beforeMismatchOss)

    globalThis.__codocsDownloadTransport = async (_event, path, options) => {
      runtimeCalls.push({ path, options })
      return { handled: true, data: { success: true, data: { uuid: 'doc-1', oss_path: 'codocs/private/doc-1.md', doc_type: 'private', title: 'Stored' } } }
    }
    globalThis.__codocsDownloadOss = async () => { throw new Error('secret storage endpoint') }
    const storageError = await fetch(`${base}/documents/doc-1/download`)
    assert.equal(storageError.status, 503)
    const storageBody = await storageError.text()
    assert.doesNotMatch(storageBody, /secret storage endpoint/)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsDownloadSession = oldSession
    globalThis.__codocsDownloadAuthorization = oldAuth
    globalThis.__codocsDownloadAuthorizationError = oldAuthError
    globalThis.__codocsDownloadTransport = oldTransport
    globalThis.__codocsDownloadPrepare = oldPrepare
    globalThis.__codocsDownloadOss = oldOss
    globalThis.__codocsDownloadRecovery = oldRecovery
    globalThis.__codocsDownloadAudit = oldAudit
  }
})
