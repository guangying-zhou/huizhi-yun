import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL(
    '../server/api/platform/internal/tenant-gateway/runtime-bootstrap-token.post.ts',
    import.meta.url
  ),
  'utf8'
)
const oidcBootstrapSource = readFileSync(
  new URL(
    '../server/api/platform/tenant-admin/deployment-settings/console-oidc-signing-bootstrap.post.ts',
    import.meta.url
  ),
  'utf8'
)

test('Tenant Gateway Runtime bootstrap token is short-lived and Console-bound', () => {
  assert.match(source, /appCode !== 'console'/)
  assert.match(source, /const expiresAt = now \+ 90/)
  assert.match(source, /aud:\s*'data-runtime-bootstrap'/)
  assert.match(source, /token_use:\s*'platform_runtime_bootstrap'/)
  assert.match(source, /scope:\s*'console:service-token:issue'/)
  assert.match(source, /sub:\s*'platform:tenant-gateway'/)
  assert.match(source, /jti:\s*randomUUID\(\)/)
  assert.match(source, /runtimeCode:\s*binding\.runtime_code/)
  assert.match(source, /deployment:\s*binding\.deployment_code/)
})

test('Tenant Gateway Runtime bootstrap token requires an active ready Runtime binding', () => {
  assert.match(source, /i\.status = 'ready'/)
  assert.match(source, /a\.status IN \('schema_ready', 'active'\)/)
  assert.match(source, /d\.status = 'active'/)
  assert.match(source, /tenant runtime binding is not ready/)
})

test('bootstrap issuer comes from the configured control plane, not production or request headers', () => {
  assert.match(source, /runtimeBootstrapIssuer\(/)
  assert.match(source, /runtimeEnv\?\.PLATFORM_SERVICE_URL/)
  assert.match(source, /process\.env\.NUXT_PUBLIC_SERVICE_URL/)
  assert.match(source, /useRuntimeConfig\(\)\.public\?\.serviceUrl/)
  assert.match(source, /iss:\s*issuer/)
  assert.doesNotMatch(source, /iss:\s*'https:\/\/huizhi\.yun'/)
  assert.doesNotMatch(source, /getRequestURL|getHeader/)
})

test('Tenant Gateway Runtime bootstrap response does not expose persistent credentials', () => {
  assert.doesNotMatch(source, /runtime_token|staticToken|privateKey/i)
  assert.match(source, /tokenType:\s*'Bearer'/)
  assert.match(source, /expiresAt:\s*new Date/)
})

test('OIDC signing custody cutover is tenant-owner initiated and sends no private key', () => {
  assert.match(oidcBootstrapSource, /requireTenantOwnerForTenantAdmin/)
  assert.match(oidcBootstrapSource, /reason:\s*'tenant-runtime-custody-cutover'/)
  assert.match(oidcBootstrapSource, /console-oidc-signing-bootstrap\.v1/)
  assert.match(oidcBootstrapSource, /await sign\(payloadJSON\)/)
  assert.match(oidcBootstrapSource, /const issuer = tenantPublicUrl\(gateway\.subdomain\)/)
  assert.match(oidcBootstrapSource, /const jwksUrl = `\$\{issuer\}\/\.well-known\/jwks\.json`/)
  assert.match(oidcBootstrapSource, /runtimeResult\.jwtTrust !== 'tenant_gateway'/)
  assert.match(oidcBootstrapSource, /console\.oidc_signing_key\.bootstrap/)
  assert.doesNotMatch(oidcBootstrapSource, /privateJwk|privateKey|CONSOLE_AUTH_SIGNING_PRIVATE_JWK/)
})
