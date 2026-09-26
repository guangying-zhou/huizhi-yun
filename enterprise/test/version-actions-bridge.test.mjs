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
test('version lifecycle Host routes preserve original validation and exact authorization', async () => {
  const root = resolve(import.meta.dirname, '../..')
  let denied = '', wrongScope = false
  const calls = [], checks = []
  const session = { authenticated: true, tokenUse: 'access', subjectType: 'user', uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
  const oldConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ public: { appCode: 'enterprise' } })
  globalThis.__planningSession = session
  globalThis.__planningTransport = async (_event, path, options) => {
    calls.push({ path, options })
    return { handled: true, data: { code: 0, data: (path.endsWith('/product-authorization') || path.endsWith('/authorization-object'))
      ? { product_code: options.body?.productCode || 'P-A', actor_uid: session.uid, revision: 3, status: 'active', is_member: true, is_manager: false }
      : { receipt_id: 'receipt-fixture', scope_revision: 2 } } }
  }
  globalThis.__planningAuthorization = async (_event, uid, app, required) => {
    checks.push({ uid, app, ...required })
    const permission = `${required.resourceCode}:${required.action}`
    return { grants: permission === denied ? [] : [{ grantId: 'explicit-person-grant', permissions: [{ appCode: app, resourceCode: required.resourceCode, action: required.action }], scopes: [{ dimension: 'product', predicate: 'code', value: wrongScope ? 'P-B' : 'P-A' }] }] }
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
    const { handleProductVersionCollection } = await import('../../aims/server/utils/productVersionRuntime.ts')
    const { handleProductVersionAcceptance } = await import('../../aims/server/utils/productVersionAcceptanceRuntime.ts')
    const router = createRouter(), app = createApp()
    app.use(defineEventHandler(event => { event.context.consoleAuth = session }))
    const cases = [
      ['edit', 'PATCH', '', { expectedRevision: 3, expectedVersionRevision: 2, versionCode: 'v2', name: 'Second', reason: 'Edit' }],
      ['delete', 'DELETE', '', { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 1, reason: 'Remove' }],
      ['transition', 'POST', '/transition', { expectedRevision: 3, expectedVersionRevision: 2, toStatus: 'developing', reason: 'Start' }],
      ['reopen', 'POST', '/reopen', { expectedRevision: 3, expectedVersionRevision: 2, releaseRecordId: 8, reason: 'Correct' }],
      ['archive', 'POST', '/archive', { expectedRevision: 3, expectedVersionRevision: 2, expectedScopeRevision: 1, reason: 'Retire' }]
    ]
    for (const [action, method, suffix] of cases) {
      const file = suffix ? `[versionId]/${action}.post.ts` : `[versionId].${method.toLowerCase()}.ts`
      const handler = (await import(`../server/routes/aims/api/v1/products/[productCode]/versions/${file}`)).default
      router.add(`/products/:productCode/versions/:versionId${suffix}`, handler, method.toLowerCase())
      router.add(`/legacy/:productCode/versions/:versionId${suffix}`, defineEventHandler(e => ['edit', 'transition'].includes(action) ? handleProductVersionCollection(e, action) : handleProductVersionAcceptance(e, action)), method.toLowerCase())
    }
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const request = async (path, method, body, key = 'version-command') => {
      const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-hzy-actor-uid': 'forged' }, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    for (const [action, method, suffix, input] of cases) {
      const path = `/products/P-A/versions/12${suffix}`
      for (const [url, body, key] of [[path, {...input, tenant:'forged'}, 'key'], [path,input,''], [path+'?actor=forged',input,'key'], [path.replace('/12','/0'),input,'key']]) {
        const before = calls.length
        assert.equal((await request(url,method,body,key)).status,400)
        assert.equal(calls.length,before)
      }
      const permission = action === 'transition' ? 'edit' : action
      denied = `product_versions:${permission}`
      assert.equal((await request(path,method,input)).status,403)
      denied = ''
      assert.equal((await request(path,method,input)).status,200)
      const command = calls.at(-1)
      assert.equal(command.path, `/v1/enterprise/aims/product-version:${action}`)
      assert.equal(command.options.scope, `aims:product-versions:${permission}`)
      assert.equal(command.options.appCode,'enterprise')
      assert.equal(command.options.body.tenant,session.tenant)
      assert.equal(command.options.body.deployment,session.deployment)
      assert.equal(command.options.body.authorization.facts.actor_uid,session.uid)
      assert.equal(command.options.body.authorization.action,permission)
      assert.equal(command.options.body.input.version_id,12)
      assert.equal(command.options.idempotencyKey,'version-command')
      const normalized = command.options.body.input
      assert.equal((await request(path.replace('/products/','/legacy/'),method,input)).status,200)
      assert.equal(calls.at(-1).path, `/v1/aims/internal/products/P-A/versions:${action}`)
      assert.deepEqual(calls.at(-1).options.body.input,normalized)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.useRuntimeConfig = oldConfig
    delete globalThis.__planningSession
    delete globalThis.__planningTransport
    delete globalThis.__planningAuthorization
  }
})
