import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs access records use fresh permission, actor binding, and path-bound idempotency', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const runtimeCalls = []
  const preparations = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsAuditSession
  const oldAuth = globalThis.__codocsAuditAuthorization
  const oldAuthError = globalThis.__codocsAuditAuthorizationError
  const oldPrepare = globalThis.__codocsAuditPrepare
  const oldTransport = globalThis.__codocsAuditTransport
  const oldMutateAfterPrepare = globalThis.__codocsAuditMutateAfterPrepare
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsAuditSession = session
  globalThis.__codocsAuditAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }
  globalThis.__codocsAuditAuthorizationError = null
  globalThis.__codocsAuditMutateAfterPrepare = false
  globalThis.__codocsAuditPrepare = async (_event, options) => {
    preparations.push(options)
    if (globalThis.__codocsAuditMutateAfterPrepare) globalThis.__codocsAuditAuthorization = { resources: { documents: [] }, actionPolicies: {} }
    return true
  }
  globalThis.__codocsAuditTransport = async (_event, path, options) => {
    runtimeCalls.push({ path, options })
    const eventId = options.body.payload.eventId
    return { handled: true, data: { success: true, data: { recorded: true, id: eventId } } }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsAuditSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsAuditPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsAuditTransport(...args)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>{if(globalThis.__codocsAuditAuthorizationError) throw globalThis.__codocsAuditAuthorizationError;return globalThis.__codocsAuditAuthorization}'
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
    const { recordEnterpriseCodocsDocumentAccess } = await import('../server/utils/enterpriseCodocsDocumentAccessRecord.ts')
    const app = createApp()
    const router = createRouter()
    router.get('/audit/:uuid', defineEventHandler(async event => {
      await recordEnterpriseCodocsDocumentAccess(event, event.context.auditUuid, event.context.auditPath, event.context.auditPermission)
      return { success: true }
    }))
    app.use(defineEventHandler(event => {
      event.context.consoleAuth = globalThis.__codocsAuditSession
      event.context.auditUuid = 'doc-1'
      event.context.auditPath = 'codocs/company/release.md'
      event.context.auditPermission = event.node.req.headers['x-audit-permission'] || 'export'
    }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`

    const success = await fetch(`${base}/audit/doc-1`)
    assert.equal(success.status, 200)
    assert.deepEqual(await success.json(), { success: true })
    assert.equal(preparations.at(-1).scope, 'codocs:document-access-records:record')
    assert.equal(preparations.at(-1).method, 'POST')
    const call = runtimeCalls.at(-1)
    assert.equal(call.path, '/v1/enterprise/codocs/document-access-records:record')
    assert.equal(call.options.scope, 'codocs:document-access-records:record')
    assert.equal(call.options.appCode, 'enterprise')
    assert.equal(call.options.capabilityFormat, 'business')
    assert.equal(call.options.serviceTokenSourceBinding, 'service-client-policy')
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.body.code, 'doc-1')
    assert.equal(call.options.body.authorization.actorUid, 'person-a')
    assert.equal(call.options.body.authorization.tenant, 'tenant-a')
    assert.equal(call.options.body.authorization.deployment, 'enterprise-test')
    assert.equal(call.options.body.authorization.resource, 'document-access-records')
    assert.equal(call.options.body.authorization.action, 'record')
    assert.ok(call.options.body.authorization.expiresAt > Date.now())
    assert.ok(call.options.body.authorization.expiresAt <= Date.now() + 15_000)
    assert.match(call.options.body.payload.eventId, /^[0-9a-f-]{36}$/)
    assert.equal(call.options.body.payload.pathSha256, createHash('sha256').update('codocs/company/release.md').digest('hex'))
    assert.equal(call.options.idempotencyKey, `codocs:access:${call.options.body.payload.eventId}`)

    const firstEventId = call.options.body.payload.eventId
    const second = await fetch(`${base}/audit/doc-1`)
    assert.equal(second.status, 200)
    const secondCall = runtimeCalls.at(-1)
    assert.notEqual(secondCall.options.body.payload.eventId, firstEventId)
    assert.equal(secondCall.options.idempotencyKey, `codocs:access:${secondCall.options.body.payload.eventId}`)

    globalThis.__codocsAuditAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    const view = await fetch(`${base}/audit/doc-1`, { headers: { 'x-audit-permission': 'view' } })
    assert.equal(view.status, 200)
    const viewCall = runtimeCalls.at(-1)
    assert.equal(viewCall.options.body.authorization.action, 'record')
    assert.equal(viewCall.options.body.code, 'doc-1')

    globalThis.__codocsAuditAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }
    globalThis.__codocsAuditMutateAfterPrepare = true
    const beforeFreshSnapshot = runtimeCalls.length
    const stale = await fetch(`${base}/audit/doc-1`)
    assert.equal(stale.status, 403)
    assert.equal(runtimeCalls.length, beforeFreshSnapshot)
    globalThis.__codocsAuditMutateAfterPrepare = false

    globalThis.__codocsAuditAuthorization = { resources: { documents: [] }, actionPolicies: {} }
    const beforeDenied = runtimeCalls.length
    const denied = await fetch(`${base}/audit/doc-1`)
    assert.equal(denied.status, 403)
    assert.equal(runtimeCalls.length, beforeDenied)

    globalThis.__codocsAuditAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }
    globalThis.__codocsAuditAuthorizationError = { statusCode: 502, statusMessage: 'ACL unavailable', message: 'ACL unavailable' }
    const beforeAclError = runtimeCalls.length
    const aclError = await fetch(`${base}/audit/doc-1`)
    assert.equal(aclError.status, 502)
    assert.equal(runtimeCalls.length, beforeAclError)
    globalThis.__codocsAuditAuthorizationError = null

    globalThis.__codocsAuditTransport = async (_event, path, options) => {
      runtimeCalls.push({ path, options })
      return { handled: true, data: { success: true, data: { recorded: true, id: 'wrong-id' } } }
    }
    const beforeInvalid = runtimeCalls.length
    const invalid = await fetch(`${base}/audit/doc-1`)
    assert.equal(invalid.status, 503)
    assert.equal(runtimeCalls.length, beforeInvalid + 1)

    globalThis.__codocsAuditAuthorization = { resources: { documents: ['export'] }, actionPolicies: {} }
    globalThis.__codocsAuditSession = { ...session, authenticated: false }
    const beforeUnauthenticated = runtimeCalls.length
    const unauthenticated = await fetch(`${base}/audit/doc-1`)
    assert.equal(unauthenticated.status, 401)
    assert.equal(runtimeCalls.length, beforeUnauthenticated)
    globalThis.__codocsAuditSession = session

  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsAuditSession = oldSession
    globalThis.__codocsAuditAuthorization = oldAuth
    globalThis.__codocsAuditAuthorizationError = oldAuthError
    globalThis.__codocsAuditPrepare = oldPrepare
    globalThis.__codocsAuditTransport = oldTransport
    globalThis.__codocsAuditMutateAfterPrepare = oldMutateAfterPrepare
  }
})
