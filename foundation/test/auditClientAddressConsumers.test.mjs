import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { IncomingMessage, ServerResponse } from 'node:http'
import { registerHooks } from 'node:module'
import { Socket } from 'node:net'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEvent, getHeader } from 'h3'

test('audit consumers persist the trusted address despite forged XFF', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { sql: [], releases: [], logs: [] }
  const globals = {
    __auditAddressFixture: state,
    defineEventHandler: handler => handler,
    readBody: async () => ({ version: '1.0.0', environment: 'test' }),
    getHeader,
    createError: input => Object.assign(new Error(input.message), input),
    useRuntimeConfig: () => ({ public: { appCode: 'codocs' } }),
    $fetch: async (_url, options) => {
      state.logs.push(options.body)
      return { code: 0 }
    },
    fetch: async (url) => {
      assert.equal(url.hostname, 'runtime.example.invalid')
      const vault = url.pathname.endsWith('console-vault-master-key')
      return Response.json({ tenantCode: 'fixture', deploymentCode: 'console-test', runtimeCode: 'runtime-test',
        status: vault ? 'imported' : 'generated', vaultMasterKeyFingerprint: 'fixture-fingerprint',
        currentKid: 'fixture-kid', issuer: 'https://fixture.invalid', jwksUrl: 'https://fixture.invalid/.well-known/jwks.json', jwtTrust: 'tenant_gateway' })
    }
  }
  const saved = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, globals)
  const mocks = {
    'api': 'export const ok=x=>x;export const normalizeNullableString=x=>x??null;export const requireString=x=>String(x)',
    'db': `const s=()=>globalThis.__auditAddressFixture;
      export const queryRow=async sql=>sql.includes('FROM deployments')?{deployment_id:1,deployment_code:'console-test',runtime_code:'runtime-test',runtime_endpoint:'https://runtime.example.invalid',runtime_status:'ready',settings_json:{}}:{id:1,account_type:'staff'};
      export const execute=async(...args)=>{s().sql.push(args);return {}};
      export const withTransaction=async fn=>fn({execute})`,
    'platformOpsRbac': 'export const ensureOpsRbacReady=async()=>{};export const grantOpsSuperAdminRoleToAccount=async()=>{}',
    'runtimeReleaseEnvironment': 'export const requireRuntimeReleaseEnvironment=x=>x',
    'dataRuntimeRelease': 'export const compareDataRuntimeVersions=()=>0;export const dataRuntimeReleaseStaticSettings=()=>({})',
    'dataRuntimeReleaseRegistry': 'const s=()=>globalThis.__auditAddressFixture;export const fetchVerifiedDataRuntimeRelease=async()=>({});export const storeDataRuntimeRelease=async(_r,a)=>{s().releases.push(a);return {}};export const approveDataRuntimeRelease=async a=>{s().releases.push(a);return {}}',
    'deploymentBootstrapSecrets': 'export const loadConsoleVaultMasterKeyForMigration=async()=>({status:\'ready\',secretId:1,value:\'disposable-fixture\',fingerprint:\'fixture-fingerprint\'});export const retireConsoleVaultMasterKeyAfterMigration=async()=>{}',
    'platformSigning': 'export const sign=async()=>({signature:"fixture",kid:"fixture",alg:"EdDSA"})',
    'tenantAdminAccess': 'export const requireTenantOwnerForTenantAdmin=()=>{}',
    'tenantDeploymentSettings': 'export const normalizeDeploymentEnvironment=x=>x;export const parseTenantSettings=x=>x;export const tenantGatewaySettings=()=>({subdomain:"fixture"});export const tenantPublicUrl=()=>"https://fixture.invalid"',
    'consoleTenantRuntimeClient': 'export const appendConsoleLoginLog=async(_e,p)=>{globalThis.__auditAddressFixture.logs.push(p)};export const appendConsoleOidcTokenEvent=appendConsoleLoginLog;export const consumeConsoleOidcAuthorizationCode=()=>{},consumeConsoleOidcRefreshToken=()=>{},getConsoleOidcPublishedJwks=()=>{},issueConsoleOidcRefreshToken=()=>{},resolveConsoleAuthSession=()=>{},resolveConsoleOidcClient=()=>{},revokeConsoleAuthSession=()=>{},revokeConsoleOidcRefreshTokens=()=>{},signConsoleOidcToken=()=>{},verifyConsoleOidcServiceTokenState=()=>{}',
    '#imports': 'export const useRuntimeConfig=()=>({})',
    'appUrls': 'export const normalizePublicUrl=x=>x,resolveCurrentAppHomeUrl=()=>""',
    'tenantGatewayTrust': 'export const resolveTrustedTenantGatewayContext=()=>null',
    'bundleCache': 'export const readCachedBundle=()=>null,verifiedPolicyStoreEnabled=()=>false',
    'platformRuntime': 'export const loadPlatformRuntimeConfig=()=>({}),resolvePlatformRuntimeCacheScope=()=>""',
    'serviceAccessTokenClaims': 'export const bindServiceAccessTokenPolicyToServiceClient=()=>{},bindServiceAccessTokenPolicyToTrustedSource=()=>{},buildServiceAccessTokenClaims=()=>{}',
    'oidcTokenLifetime': 'export const clampRefreshTokenTtlSeconds=x=>x',
    'configuredGatewayIssuer': 'export const configuredGatewayIssuer=()=>""',
    'localGatewayIssuer': 'export const localGatewayIssuer=()=>""',
    'localConsoleFacade': 'export const resolveLocalConsoleFacade=()=>null',
    'authDependencyDiagnostic': 'export const logAuthDependencyFailure=()=>{}',
    'serviceOidc': 'export const requestServiceAccessToken=async()=>"fixture"',
    'consoleServiceBinding': 'export const consoleServiceFetch=async(_e,_u,o)=>{globalThis.__auditAddressFixture.logs.push(o.body);return {code:0}}',
    'consoleRuntime': 'export const resolveConsoleRuntimeBaseUrl=()=>"https://console.example.invalid"',
    'cookie-domain': 'export const getAuthCookieOptions=()=>({})',
    'accountLookup': 'export const getUserByEmail=async()=>null',
    'authIdentity': 'export const isLegacyAuthEnabled=()=>true',
    'directoryCompat': 'export const fetchDirectoryUser=async()=>null',
    'wecom': 'export const getWecomUserByCode=async()=>({});export const getWecomUserDetail=async()=>({})'
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const name = specifier.split('/').at(-1)
    if (mocks[name]) return { url: `data:text/javascript,${encodeURIComponent(mocks[name])}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('~~/')) candidate = resolve(root, 'platform', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return next(pathToFileURL(`${candidate}.ts`).href, context)
    return next(specifier, context)
  } })
  try {
    const { getRequestIp, reportLoginAudit } = await import('../server/utils/accountApi.ts')
    const { getAuthRequestIp, writeAuthLoginEvent } = await import('../../console/server/utils/authAudit.ts')
    const { writeTokenEvent } = await import('../../console/server/utils/oidc.ts')
    const { createPlatformSession } = await import('../../platform/server/utils/platformAuth.ts')
    const routes = await Promise.all([
      import('../../platform/server/api/platform/ops/runtime-releases/approve.post.ts'),
      import('../../platform/server/api/platform/ops/runtime-releases/sync.post.ts'),
      import('../../platform/server/api/platform/tenant-admin/deployment-settings/console-vault-migration.post.ts'),
      import('../../platform/server/api/platform/tenant-admin/deployment-settings/console-oidc-signing-bootstrap.post.ts')
    ])
    const { default: wecomCallback } = await import('../../codocs/server/api/auth/wecom-callback.get.ts')
    for (const [peer, realIp, expected] of [
      ['203.0.113.7', '198.51.100.9', '203.0.113.7'],
      ['127.0.0.1', '203.0.113.8', '203.0.113.8'],
      ['::ffff:127.0.0.1', undefined, '127.0.0.1'],
      ['10.0.0.1', 'invalid-address', '10.0.0.1'],
      [undefined, '198.51.100.9', null]
    ]) {
      const socket = new Socket()
      Object.defineProperty(socket, 'remoteAddress', { value: peer })
      const req = new IncomingMessage(socket)
      req.url = '/'
      req.headers = { 'x-forwarded-for': '198.51.100.99, 198.51.100.100', 'x-real-ip': realIp }
      const event = createEvent(req, new ServerResponse(req))
      Object.assign(event.context, { platformTenantCode: 'fixture', platformUid: 'actor', platformAccountId: 1 })
      state.sql.length = state.releases.length = state.logs.length = 0
      try {
        await reportLoginAudit({ loginType: 'sso', loginResult: 1, ipAddress: getRequestIp(event) })
        await writeAuthLoginEvent(event, { loginResult: 'success', ipAddress: getAuthRequestIp(event) })
        await writeTokenEvent(event, { eventType: 'token.issue', result: 'success' })
        await assert.rejects(wecomCallback(event), { statusCode: 400 })
        assert.equal(state.logs.length, 4)
        for (const log of state.logs) assert.equal(log.ipAddress, expected)
        for (const route of routes) await route.default(event)
        await createPlatformSession(event, { accountId: 1, idpType: 'fixture' })
        assert.equal(state.releases.length, 2)
        for (const record of state.releases) assert.equal(record.ip, expected)
        assert.equal(state.sql.length, 3)
        for (const [sql, params] of state.sql) {
          assert.match(sql, /INSERT INTO (tenant_audit_logs|platform_sessions)/)
          assert.equal(params[6], expected)
        }
      } finally {
        socket.destroy()
      }
    }
  } finally {
    hooks.deregister()
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
