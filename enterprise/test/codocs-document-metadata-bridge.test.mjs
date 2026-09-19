import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise Codocs metadata PATCH is actor-bound, field-bound, and idempotent', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const calls = []
  const preparations = []
  const session = {
    authenticated: true,
    tokenUse: 'access',
    subjectType: 'user',
    uid: 'person-a',
    tenant: 'tenant-a',
    deployment: 'enterprise-test'
  }
  const oldConfig = globalThis.useRuntimeConfig
  const oldDefineEventHandler = globalThis.defineEventHandler
  const oldSession = globalThis.__codocsMetadataSession
  const oldAuthorization = globalThis.__codocsMetadataAuthorization
  const oldTransport = globalThis.__codocsMetadataTransport
  const oldPrepare = globalThis.__codocsMetadataPrepare
  const oldHash = globalThis.__codocsMetadataHash

  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' }, hzy: { appCode: 'enterprise' } })
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsMetadataSession = session
  globalThis.__codocsMetadataAuthorization = {
    resources: { documents: ['edit'] },
    actionPolicies: {}
  }
  globalThis.__codocsMetadataPrepare = async (_event, options) => {
    preparations.push(options)
    return true
  }
  globalThis.__codocsMetadataHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  globalThis.__codocsMetadataTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { success: true } }
  }

  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/consoleSessionBridge')) source = 'export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__codocsMetadataSession'
      if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const prepareTenantRuntime=async(...args)=>globalThis.__codocsMetadataPrepare(...args);export const maybeCallTenantRuntime=(...args)=>globalThis.__codocsMetadataTransport(...args);export const hashServiceCommandPayload=async payload=>globalThis.__codocsMetadataHash(payload)'
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>globalThis.__codocsMetadataAuthorization'
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
    router.patch('/documents/:uuid', (await import('../server/routes/codocs/api/documents/[uuid].patch.ts')).default)
    app.use(defineEventHandler(event => { event.context.consoleAuth = globalThis.__codocsMetadataSession }))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const body = { title: 'Renamed', folder_id: 7, star_flag: 1, home_flag: 0, readonly_flag: 0 }

    const response = await fetch(`${base}/documents/doc-fixed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    const call = calls[0]
    assert.equal(call.path, '/v1/enterprise/codocs/personal-documents:edit-metadata')
    assert.equal(call.options.appCode, 'enterprise')
    assert.equal(call.options.scope, 'codocs:personal-documents:edit')
    assert.equal(call.options.body.code, 'doc-fixed')
    assert.deepEqual(call.options.body.payload, body)
    assert.equal(call.options.body.authorization.actorUid, 'person-a')
    assert.equal(call.options.body.authorization.tenant, 'tenant-a')
    assert.equal(call.options.body.authorization.deployment, 'enterprise-test')
    assert.equal(call.options.body.authorization.resource, 'personal-documents')
    assert.equal(call.options.body.authorization.action, 'edit')
    assert.ok(call.options.body.authorization.expiresAt > Date.now())
    assert.equal(preparations.at(-1).scope, 'codocs:personal-documents:edit')
    assert.equal(preparations.at(-1).method, 'POST')
    const expectedHash = globalThis.__codocsMetadataHash({ actor: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', uuid: 'doc-fixed', payload: body })
    assert.equal(call.options.idempotencyKey, `codocs:metadata:${expectedHash}`)

    const repeat = await fetch(`${base}/documents/doc-fixed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    assert.equal(repeat.status, 200)
    assert.equal(calls.at(-1).options.idempotencyKey, call.options.idempotencyKey)

    for (const invalid of [
      {},
      { owner: 'person-b' },
      { ossPath: 'oss/private/doc' },
      { title: 'ok', unknown: true },
      { uuid: 'other-doc', title: 'ok' }
    ]) {
      const before = calls.length
      const invalidResponse = await fetch(`${base}/documents/doc-fixed`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalid)
      })
      assert.equal(invalidResponse.status, 400)
      assert.equal(calls.length, before)
    }

    const queryResponse = await fetch(`${base}/documents/doc-fixed?include_deleted=1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'query rejected' })
    })
    assert.equal(queryResponse.status, 400)

    globalThis.__codocsMetadataAuthorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await fetch(`${base}/documents/doc-fixed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'readonly' })
    })).status, 403)

    globalThis.__codocsMetadataSession = { ...session, authenticated: false }
    assert.equal((await fetch(`${base}/documents/doc-fixed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'unauthenticated' })
    })).status, 401)
    globalThis.__codocsMetadataSession = session
    globalThis.__codocsMetadataAuthorization = { resources: { documents: ['edit'] }, actionPolicies: {} }

    globalThis.__codocsMetadataTransport = async () => ({ handled: false })
    assert.equal((await fetch(`${base}/documents/doc-fixed`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'runtime unavailable' })
    })).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    globalThis.defineEventHandler = oldDefineEventHandler
    globalThis.__codocsMetadataSession = oldSession
    globalThis.__codocsMetadataAuthorization = oldAuthorization
    globalThis.__codocsMetadataTransport = oldTransport
    globalThis.__codocsMetadataPrepare = oldPrepare
    globalThis.__codocsMetadataHash = oldHash
  }
})
