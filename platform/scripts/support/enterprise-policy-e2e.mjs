import { testEnterpriseApprovedOrder } from './enterprise-approved-order-e2e.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { testEnterpriseProvisioning } from './enterprise-provisioning-e2e.mjs'
import { testEnterpriseOrderFlow } from './enterprise-order-e2e.mjs'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, createError } from 'h3'
import { registerEnterpriseNuxtTestHost } from './enterprise-nuxt-test-host.mjs'
import { createEnterpriseEntitlementRepository } from '../../server/utils/enterpriseEntitlementRepository.ts'
import { createEnterpriseEntitlementStateRepository } from '../../server/utils/enterpriseEntitlementState.ts'
import { loadEnterpriseHostModuleRoutes, applyEnterpriseHostModuleRoutes, enterpriseHostRoutesMatch } from '../../server/utils/enterpriseModuleRoutes.ts'
import { enterpriseModuleAvailability, loadBundleEnterpriseEntitlement } from '../../server/utils/enterpriseEntitlementBundle.ts'

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Real Platform signer, Console verifier/cache/snapshot and Foundation scope evaluator.
 * Only Nuxt host globals and Service Binding transport are supplied by this fixture. */
export async function testEnterprisePolicyBoundary({ rootDir, context, pool, withTransaction }) {
  const hooks = registerEnterpriseNuxtTestHost(rootDir, { policyStore: true })
  const OriginalDate = globalThis.Date
  let clock = OriginalDate.parse('2026-09-13T00:00:00Z')
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  const saved = { config: globalThis.useRuntimeConfig, event: globalThis.__enterpriseTestEvent, requestEvent: globalThis.useRequestEvent, error: globalThis.createError }
  const key = generateKeyPairSync('ed25519')
  const publicKey = key.publicKey.export({ type: 'spki', format: 'pem' })
  const keyEnvName = 'ENTERPRISE_E2E_TEST_SIGNING_KEY'
  const oldPrivate = process.env[keyEnvName]
  process.env[keyEnvName] = key.privateKey.export({ type: 'pkcs8', format: 'pem' })
  let platformDb
  const previousPolicyStore = globalThis.__enterprisePolicyStore
  try {
    await pool.query(`CREATE TABLE platform_signing_keys (id BIGINT PRIMARY KEY, kid VARCHAR(128), alg VARCHAR(32), public_key TEXT, private_key_ref VARCHAR(255), status VARCHAR(32), activated_at DATETIME, rotated_at DATETIME NULL, revoked_at DATETIME NULL)`)
    await pool.execute('INSERT INTO platform_signing_keys VALUES (1,\'enterprise-e2e-key\',\'Ed25519\',?,?,\'active\',\'2026-01-01\',NULL,NULL)', [publicKey, `env:${keyEnvName}`])
    await pool.query('INSERT INTO tenants VALUES (\'e2e-a\',\'active\'),(\'e2e-b\',\'active\'); INSERT INTO tenant_subscriptions VALUES (41,\'e2e-a\',\'active\',\'2026-01-01\',\'2027-01-01\',NULL,\'legacy\',\'2026-01-01\'),(42,\'e2e-b\',\'active\',\'2026-01-01\',\'2027-01-01\',NULL,\'legacy\',\'2026-01-01\')')
    const runtimeConfig = {
      db: { ...context.connection('console'), name: context.connection('console').database },
      consoleRuntime: { activationMode: 'managed-cloud-multitenant', runMode: 'test', backgroundJobsEnabled: false },
      platform: { baseUrl: 'https://enterprise-platform.invalid', environment: 'test', signingKid: 'enterprise-e2e-key', signingPubkey: publicKey, runtimeEnabled: true, heartbeatEnabled: false, authClientMaterialize: false, bundleRefreshOnBoot: false, bundleCacheDir: context.rootDir },
      public: { appCode: 'console' }
    }
    globalThis.useRuntimeConfig = () => runtimeConfig
    globalThis.useRequestEvent = () => globalThis.__enterpriseTestEvent
    globalThis.createError = createError
    const { sign } = await import('../../server/utils/platformSigning.ts')
    platformDb = await import('../../server/utils/db.ts')
    const runtime = await import('../../../console/server/utils/platformRuntime.ts')
    const cache = await import('../../../console/server/utils/bundleCache.ts')
    const { createConsolePolicyStore } = await import('../../../foundation/server/utils/consolePolicyStore.ts')
    const persistent = await import('../../../console/server/utils/persistentPolicyBundle.ts')
    await pool.query('CREATE TABLE enterprise_e2e_policy_store (object_key VARCHAR(255) PRIMARY KEY, body LONGTEXT NOT NULL, etag BIGINT NOT NULL)')
    const makePolicyStore = () => createConsolePolicyStore(async (path, options) => {
      assert.equal(path, '/v1/console/policy-bundle')
      assert.equal(options.serviceTokenSourceBinding, 'service-client-policy')
      if (options.method === 'GET') {
        assert.equal(options.scope, 'console:policy-bundle:read')
        const [rows] = await pool.execute('SELECT body, CAST(etag AS CHAR) AS etag FROM enterprise_e2e_policy_store WHERE object_key=?', [options.query.key])
        return {code:0,data:rows[0] || null}
      }
      assert.equal(options.scope, 'console:policy-bundle:write')
      assert.match(options.idempotencyKey, /^[a-f0-9]{64}$/)
      const {key,body,expectedEtag}=options.body
      if (expectedEtag) {
        const [result]=await pool.execute('UPDATE enterprise_e2e_policy_store SET body=?, etag=etag+1 WHERE object_key=? AND etag=?',[body,key,expectedEtag])
        return {code:0,data:{stored:result.affectedRows===1}}
      }
      const [result]=await pool.execute('INSERT IGNORE INTO enterprise_e2e_policy_store VALUES (?,?,1)',[key,body])
      return {code:0,data:{stored:result.affectedRows===1}}
    })
    globalThis.__enterprisePolicyStore = makePolicyStore()
    const authorization = await import('../../../console/server/utils/policyAuthorization.ts')
    const { evaluatePolicyBundleScopedAuthorization } = await import('../../../foundation/server/utils/applicationAuthorization.ts')
    const repo = createEnterpriseEntitlementRepository(withTransaction)
    const states = createEnterpriseEntitlementStateRepository(withTransaction)
    const now = () => new Date().toISOString()
    for (const tenantCode of ['e2e-a', 'e2e-b']) {
      const preview = await repo.convert({ tenantCode, migrationId: 'policy-e2e' }, now())
      await repo.convert({ tenantCode, migrationId: 'policy-e2e', mode: 'apply', expectedRevision: 0, sourceHash: preview.result.sourceHash }, now())
    }
    let transportMode = 'valid'
    let requests = 0
    let moduleRouting = false
    let routingRevision = 100
    const payloadFor = async tenantCode => {
      const payload = {
      schemaVersion: 'policy-bundle.v2', policyRevision: await pool.query('SELECT revision FROM tenant_enterprise_entitlement_current WHERE tenant_code=?',[tenantCode]).then(([rows]) => Number(rows[0].revision)), environment: 'test', tenant: { tenantCode, status: 'active' },
      enterpriseEntitlement: await loadBundleEnterpriseEntitlement(async (sql, params) => (await pool.query(sql, params))[0][0] || null, tenantCode, 'active', now()),
      applications: [{ appCode: 'console', status: 'active' }, { appCode: 'people', status: 'active' }, { appCode: 'finance', status: 'active' }],
      subjects: [{ subjectType: 'user', subjectCode: 'subject-u1', externalRef: 'u1', status: 'active' }],
      roles: [{ roleCode: 'custom-viewer', roleName: 'Custom scoped viewer', appCode: null, status: 'active', isAssignable: 1 }],
      roleAssignments: [{ assignmentId: 51, subjectType: 'user', subjectCode: 'subject-u1', roleCode: 'custom-viewer', status: 'active' }],
      rolePermissionGrants: [
        { grantId: 'console-view', roleCode: 'custom-viewer', appCode: 'console', resourceCode: 'org_profile', action: 'view', status: 'active' },
        { grantId: 'people-view', roleCode: 'custom-viewer', appCode: 'people', resourceCode: 'employees', action: 'view', status: 'active' }
      ],
      assignmentScopes: [{ assignmentId: 51, appCode: 'people', resourceCode: 'employees', action: 'view', scopeDimension: 'department', scopePredicate: 'self', scopeValue: 'dept-a', scopeMode: 'replace', status: 'active' }],
      baselineGrants: [], actionImplications: []
      }
      if (moduleRouting && tenantCode === 'provision-a') {
        const routes = await loadEnterpriseHostModuleRoutes(async (sql, params) => (await pool.query(sql, params))[0][0] || null, tenantCode, 'test')
        payload.policyRevision = routingRevision
        payload.enterpriseHostRoutes = routes
        payload.deployment = { publicUrl: 'https://fixture.invalid', rootAppCode: 'enterprise' }
        payload.applications = applyEnterpriseHostModuleRoutes([{appCode:'console',status:'active'},{appCode:'aims',status:'active'},{appCode:'assets',status:'active'}],routes)
        payload.moduleAvailability = enterpriseModuleAvailability(payload.applications,[],routes)
        payload.rolePermissionGrants = [{grantId:'aims-view',roleCode:'custom-viewer',appCode:'aims',resourceCode:'projects',action:'view',status:'active'}]
        payload.assignmentScopes = [{assignmentId:51,appCode:'aims',resourceCode:'projects',action:'view',scopeDimension:'department',scopePredicate:'self',scopeValue:'dept-a',scopeMode:'replace',status:'active'}]
      }
      return payload
    }
    const binding = { async fetch(url) {
      requests++
      if (transportMode === 'outage') return new Response('{}', { status: 503 })
      const requestedTenant = new URL(url).pathname.split('/').at(-2)
      const tenantCode = transportMode === 'wrong-tenant' ? 'e2e-b' : requestedTenant
      const bundle = await payloadFor(tenantCode)
      if (transportMode === 'same-revision-conflict') bundle.enterpriseEntitlement.effectiveFrom = '2026-09-02T00:00:00.000Z'
      if (transportMode === 'same-policy-conflict') bundle.roles.push({roleCode:'extra-role',status:'active'})
      const payloadJson = canonical(bundle)
      const signature = await sign(payloadJson)
      const bundleHash = `sha256_${createHash('sha256').update(payloadJson).digest('hex')}`
      const data = { tenantCode, deploymentId: `${tenantCode}-console`, bundleVersion: `e2e-${bundle.enterpriseEntitlement.revision}`, bundleHash, schemaVersion: 'policy-bundle.v2', status: 'active', generatedAt: now(), expiresAt: null, signedAt: now(), bundle, ...signature }
      if (transportMode === 'bad-signature') data.signature = Buffer.alloc(64).toString('base64url')
      return new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } })
    } }
    const makeEvent = (tenantCode) => {
      const req = new IncomingMessage(new Socket())
      req.url = '/api/auth/permissions'
      req.headers = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': 'fixture-gateway-token', 'x-hzy-tenant': tenantCode, 'x-hzy-deployment': `${tenantCode}-console`, 'x-hzy-environment': 'test' }
      const event = createEvent(req, new ServerResponse(req))
      event.context.cloudflare = { env: { HZY_PLATFORM_SERVICE: binding, HZY_PLATFORM_BUNDLE_CACHE_BACKEND: 'runtime', HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS: '300000', HZY_CONSOLE_ACTIVATION_MODE: 'managed-cloud-multitenant', HZY_CONSOLE_RUN_MODE: 'test', HZY_TENANT_GATEWAY_INTERNAL_TOKEN: 'fixture-gateway-token', HZY_CONSOLE_PLATFORM_SERVICE_TOKEN: 'fixture-internal-service', HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false', HZY_PLATFORM_HEARTBEAT_ENABLED: 'false' } }
      return event
    }
    const event = makeEvent('e2e-a')
    globalThis.__enterpriseTestEvent = event
    const config = runtime.loadPlatformRuntimeConfig(event)
    const scope = runtime.resolvePlatformRuntimeCacheScope(config, event)
    const verified = await runtime.fetchAndVerifyPolicyBundle(config)
    await cache.writeCachedBundle(config.bundleCacheDir, verified, scope)
    await cache.patchActivationStatus(config.bundleCacheDir, { activated: true, bundleReady: true, mode: 'active' }, scope)
    const snapshot = await authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true })
    assert.equal(authorization.hasPermissionInSnapshot(snapshot, 'org_profile', 'view'), true)
    assert.equal(authorization.hasPermissionInSnapshot(snapshot, 'org_profile', 'edit'), false)
    const scoped = departmentCode => evaluatePolicyBundleScopedAuthorization({ payload: verified.payload, uid: 'u1', required: { appCode: 'people', resourceCode: 'employees', action: 'view' }, object: { departmentCode } })
    assert.equal(scoped('dept-a').allowed, true)
    assert.equal(scoped('dept-b').allowed, false)
    assert.equal(evaluatePolicyBundleScopedAuthorization({ payload: verified.payload, uid: 'u1', required: { appCode: 'finance', resourceCode: 'invoices', action: 'edit' } }).allowed, false)
    for (const mode of ['wrong-tenant', 'bad-signature']) {
      transportMode = mode
      await assert.rejects(runtime.fetchAndVerifyPolicyBundle(config), mode === 'wrong-tenant' ? /tenant mismatch/ : /signature verification failed/)
    }
    transportMode = 'valid'
    const command = { tenantCode: 'e2e-a', operationId: 'e2e-suspend', expectedRevision: 1, action: 'suspend', actorUid: 'ops-fixture', reason: 'boundary test' }
    await states.change(command, now())
    const beforeRefresh = requests
    clock += 300001
    await assert.rejects(authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true }), {statusCode:503})
    assert.equal(requests, beforeRefresh)
    await cache.writeCachedBundle(config.bundleCacheDir, await runtime.fetchAndVerifyPolicyBundle(config), scope)
    await assert.rejects(authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true }), /Enterprise access is not active/)
    assert.ok(requests > beforeRefresh)
    assert.equal((await cache.readCachedBundle(config.bundleCacheDir, scope)).payload.enterpriseEntitlement.revision, 2)
    await assert.rejects(cache.writeCachedBundle(config.bundleCacheDir, { ...verified, cachedAt: now() }, scope), /enterprise bundle rollback rejected/)
    await states.change({ ...command, operationId: 'e2e-restore', expectedRevision: 2, action: 'restore' }, now())
    clock += 300001
    await cache.writeCachedBundle(config.bundleCacheDir, await runtime.fetchAndVerifyPolicyBundle(config), scope)
    assert.equal(authorization.hasPermissionInSnapshot(await authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true }), 'org_profile', 'view'), true)
    assert.equal((await cache.readCachedBundle(config.bundleCacheDir, scope)).payload.enterpriseEntitlement.end.effectiveUntil, '2027-01-01T00:00:00.000Z')
    clock += 300001
    transportMode = 'outage'
    await assert.rejects(authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true }), { statusCode: 503 })
    transportMode = 'valid'
    await states.change({ ...command, operationId: 'e2e-revoke', expectedRevision: 3, action: 'revoke' }, now())
    await cache.writeCachedBundle(config.bundleCacheDir, await runtime.fetchAndVerifyPolicyBundle(config), scope)
    globalThis.__enterprisePolicyStore = makePolicyStore()
    await assert.rejects(persistent.storePolicyBundle(globalThis.__enterprisePolicyStore, scope, 'fixture-gateway-token', { ...verified, cachedAt: now() }, clock), /durable revision rollback/)
    for (const mode of ['same-revision-conflict','same-policy-conflict']) {
      transportMode=mode
      const conflict = await runtime.fetchAndVerifyPolicyBundle(config)
      await assert.rejects(cache.writeCachedBundle(config.bundleCacheDir,conflict,scope),/conflict/)
    }
    transportMode='valid'
    await new Promise((resolveRun,reject) => {
      const child=spawn(process.execPath,['--experimental-strip-types',new URL('./enterprise-policy-restart.mjs',import.meta.url).pathname],{stdio:['pipe','inherit','inherit']})
      child.stdin.end(JSON.stringify({connection:context.connection('console'),scope,secret:'fixture-gateway-token',oldBundle:verified}))
      child.once('error',reject)
      child.once('exit',code => code===0 ? resolveRun() : reject(Error(`Fresh policy process exited ${code}`)))
    })
    await assert.rejects(authorization.loadPolicyAuthorizationSnapshot('u1', 'console', event, { ignoreSimulationSession: true }), /Enterprise access is not active/)
    const second = makeEvent('e2e-b')
    globalThis.__enterpriseTestEvent = second
    clock = OriginalDate.parse('2027-01-01T00:00:00Z')
    const secondConfig = runtime.loadPlatformRuntimeConfig(second)
    await cache.writeCachedBundle(secondConfig.bundleCacheDir, await runtime.fetchAndVerifyPolicyBundle(secondConfig), runtime.resolvePlatformRuntimeCacheScope(secondConfig, second))
    await assert.rejects(authorization.loadPolicyAuthorizationSnapshot('u1', 'console', second, { ignoreSimulationSession: true }), /Enterprise access is not active/)
    await testEnterpriseOrderFlow({ pool, withTransaction })
    clock = OriginalDate.parse('2026-09-13T00:00:00Z')
    await testEnterpriseProvisioning({ rootDir, pool, withTransaction, publicKey })
    await testEnterpriseApprovedOrder({rootDir,pool,withTransaction})
    moduleRouting = true
    transportMode = 'valid'
    const routeEvent = makeEvent('provision-a')
    globalThis.__enterpriseTestEvent = routeEvent
    const routeConfig = runtime.loadPlatformRuntimeConfig(routeEvent)
    const routeScope = runtime.resolvePlatformRuntimeCacheScope(routeConfig,routeEvent)
    const { getConsoleUserApplications } = await import('../../../console/server/utils/userApplications.ts')
    const refreshRoutes = async () => {
      routingRevision++
      const bundle = await runtime.fetchAndVerifyPolicyBundle(routeConfig)
      await cache.writeCachedBundle(routeConfig.bundleCacheDir,bundle,routeScope)
      return { bundle, apps: await getConsoleUserApplications(routeEvent,'u1') }
    }
    const notReported = await refreshRoutes()
    assert.equal(notReported.apps.find(app=>app.appCode==='aims')?.homeUrl,null)
    await pool.query("UPDATE deployments d INNER JOIN platform_applications a ON a.app_code=d.app_code INNER JOIN platform_app_manifests m ON m.id=a.latest_manifest_id SET d.reported_manifest_hash=m.manifest_hash WHERE d.tenant_code='provision-a' AND d.app_code='enterprise'")
    const routed = await refreshRoutes()
    assert.equal(routed.bundle.payload.enterpriseHostRoutes.length,2,'Producer routes require matching actual Host evidence')
    assert.equal(routed.apps.find(app=>app.appCode==='aims')?.homeUrl,'https://fixture.invalid/aims/')
    assert.equal(routed.apps.find(app=>app.appCode==='aims')?.deploymentState,'deployed')
    assert.equal(routed.apps.some(app=>app.appCode==='assets'),false)
    assert.equal(routed.bundle.payload.enterpriseHostRoutes.length,2)
    assert.equal(routed.bundle.payload.applications.find(app=>app.appCode==='aims').apiBase,'/aims/api/v1')
    const routeSnapshot = await authorization.loadPolicyAuthorizationSnapshot('u1','aims',routeEvent,{ignoreSimulationSession:true})
    const aimDecision = (action,departmentCode) => evaluatePolicyBundleScopedAuthorization({payload:routeSnapshot.payload,uid:'u1',required:{appCode:'aims',resourceCode:'projects',action},object:{departmentCode}})
    assert.equal(aimDecision('view','dept-a').allowed,true)
    assert.equal(aimDecision('edit','dept-a').allowed,false)
    const decision = evaluatePolicyBundleScopedAuthorization({payload:routeSnapshot.payload,uid:'u1',required:{appCode:'aims',resourceCode:'projects',action:'view'},object:{departmentCode:'dept-b'}})
    assert.equal(decision.allowed,false)
    assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM deployments WHERE tenant_code='provision-a' AND app_code IN ('aims','assets')"))[0][0].n),0)
    await pool.query("UPDATE deployments SET reported_manifest_hash='mismatched' WHERE tenant_code='provision-a' AND app_code='enterprise'")
    const mismatch = await refreshRoutes()
    assert.equal(mismatch.apps.find(app=>app.appCode==='aims')?.homeUrl,null)
    assert.equal(enterpriseHostRoutesMatch(routed.bundle.payload,mismatch.bundle.payload.enterpriseHostRoutes),false)
    await pool.query("UPDATE deployments d INNER JOIN platform_applications a ON a.app_code=d.app_code INNER JOIN platform_app_manifests m ON m.id=a.latest_manifest_id SET d.reported_manifest_hash=m.manifest_hash WHERE d.tenant_code='provision-a' AND d.app_code='enterprise'")
    await pool.query("UPDATE deployments SET status='suspended' WHERE tenant_code='provision-a' AND app_code='enterprise'")
    assert.equal((await refreshRoutes()).apps.find(app=>app.appCode==='aims')?.homeUrl,null)
    await pool.query("UPDATE deployments SET status='active' WHERE tenant_code='provision-a' AND app_code='enterprise'")
    const queryFixture = async (sql,params)=>(await pool.query(sql,params))[0][0] || null
    assert.deepEqual(await loadEnterpriseHostModuleRoutes(queryFixture,'provision-b','test'),[])
    assert.deepEqual(await loadEnterpriseHostModuleRoutes(queryFixture,'provision-a','prod'),[])
    await pool.query("UPDATE deployment_sites SET public_url='javascript:alert(1)' WHERE tenant_code='provision-a'")
    assert.deepEqual(await loadEnterpriseHostModuleRoutes(queryFixture,'provision-a','test'),[])
    await pool.query("UPDATE deployment_sites SET public_url='https://fixture.invalid' WHERE tenant_code='provision-a'")
    await pool.query("UPDATE platform_app_manifests SET manifest_json=JSON_SET(manifest_json,'$.appName','drift') WHERE app_code='assets'")
    const drift = await refreshRoutes()
    assert.equal(drift.apps.find(app=>app.appCode==='aims')?.homeUrl,null)
    console.log('Enterprise Host routing: real signed/cache/userApplications entry, matching runtime manifest, logical scope preservation, missing report/hash drift/catalog drift rejection passed.')

    console.log('Enterprise signed boundary: real Platform signer, Console verification/cache/authorization, scope isolation, state/expiry, tamper and refresh failure passed.')
  } catch (error) {
    console.error(error.stack)
    throw error
  } finally {
    if (platformDb) await platformDb.useDbPool().end()
    if (oldPrivate === undefined) delete process.env[keyEnvName]
    else process.env[keyEnvName] = oldPrivate
    globalThis.Date = OriginalDate
    globalThis.useRuntimeConfig = saved.config
    globalThis.useRequestEvent = saved.requestEvent
    globalThis.__enterpriseTestEvent = saved.event
    globalThis.createError = saved.error
    globalThis.__enterprisePolicyStore = previousPolicyStore
    hooks.deregister()
  }
}
