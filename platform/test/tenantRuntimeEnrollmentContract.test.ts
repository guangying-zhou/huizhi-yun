import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('tenant runtime enrollment contract', () => {
  test('copied installer verifies the independently served key and installer signature before sudo', () => {
    const content = source('server/api/platform/tenant-admin/deployment-settings/install-command.post.ts')
    const fingerprint = content.indexOf('release signing key fingerprint mismatch')
    const signature = content.indexOf('openssl pkeyutl -verify')
    const sudo = content.indexOf('\'sudo env')

    assert.ok(fingerprint > 0)
    assert.ok(signature > fingerprint)
    assert.ok(sudo > signature)
    assert.doesNotMatch(content, /curl -fsSL[^\n]+\|/)
    assert.doesNotMatch(content, /HZY_DATA_RUNTIME_STATIC_TOKEN=/)
    assert.match(content, /HZY_DATA_RUNTIME_ENROLLMENT_CODE=/)
    assert.match(content, /HZY_DATA_RUNTIME_AUTH_MODE=/)
    assert.match(content, /HZY_DATA_RUNTIME_JWT_ISSUER=/)
    assert.match(content, /HZY_DATA_RUNTIME_JWKS_URL=/)
    assert.match(content, /const consoleIssuer = tenantPublicUrl\(gateway\.subdomain\)/)
    assert.match(content, /jwtIssuer:\s*consoleIssuer/)
    assert.match(content, /HZY_DIRECTORY_CONNECTOR_ENABLED=/)
    assert.match(content, /HZY_DIRECTORY_RUNTIME_ENABLED=/)
    assert.match(content, /HZY_DIRECTORY_CONNECTOR_CONSOLE_URL=/)
    assert.match(content, /\/directory-connector/)
    assert.match(content, /HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN=/)
    assert.match(content, /HZY_CONSOLE_RUNTIME_ENABLED=/)
    assert.match(content, /HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_ID=/)
    assert.match(content, /HZY_DATA_RUNTIME_PLATFORM_SIGNING_KEY_PEM_BASE64=/)
    assert.match(content, /platformSigningPublicKey:\s*connectorSignature\.publicKey/)
    assert.match(content, /directory-connector-enrollment\.v1/)
    assert.match(content, /--version/)
    assert.match(content, /--update-version/)
    assert.match(content, /return \[\s*'\(',\s*'set -eu'/)
    assert.match(content, /bash "\$HZY_INSTALL_TMP\/install\.sh"[\s\S]*\n\s*'\)'/)
  })

  test('enrollment codes are hashed, single-use, expiring and atomically redeemed', () => {
    const content = source('server/utils/tenantRuntimeEnrollment.ts')

    assert.match(content, /hashTenantRuntimeSecret\(code\)/)
    assert.match(content, /status = 'revoked'/)
    assert.match(content, /DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL \? SECOND\)/)
    assert.match(content, /FOR UPDATE/)
    assert.match(content, /status = 'redeemed'/)
    assert.match(content, /hzy_ctl_/)
    assert.match(content, /runtime_token_hash/)
    assert.match(content, /control_token_hash/)
    assert.match(content, /status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'enrolled' END/)
  })

  test('Cloudflare production keeps trust material in runtime bindings and resolves approval from the registry', () => {
    const helper = source('server/utils/dataRuntimeRelease.ts')
    const registry = source('server/utils/dataRuntimeReleaseRegistry.ts')
    const wrangler = source('wrangler.jsonc')

    assert.match(helper, /requestCloudflareEnvValue\(name\)/)
    assert.match(helper, /globalThis\.__hzyCloudflareEnv/)
    assert.match(helper, /approvedReleaseFromRegistry\(\)/)
    assert.match(helper, /approvedSource: approvedRelease \? 'registry'/)
    assert.match(helper, /approvedRelease\.release_signing_key_id !== settings\.releaseSigningKeyId/)
    assert.match(registry, /platform_runtime_release_channels/)
    assert.match(helper, /runtimeValue\(config\.releasePublicKeyPem, 'HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM'\)/)
    assert.match(wrangler, /"HZY_DATA_RUNTIME_APPROVED_VERSION"/)
    assert.match(wrangler, /"HZY_DATA_RUNTIME_JWT_ISSUER": "https:\/\/console\.huizhi\.yun"/)
    assert.doesNotMatch(wrangler, /HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM/)
  })

  test('re-running the copied installer upgrades existing agents from static-token to JWT verification without reconfiguration', () => {
    const installer = source('../data-runtime/deploy/install.sh')

    assert.match(installer, /activation_keys=\([\s\S]*HZY_DATA_RUNTIME_AUTH_MODE/)
    assert.match(installer, /activation_keys=\([\s\S]*HZY_DATA_RUNTIME_JWT_ISSUER/)
    assert.match(installer, /activation_keys=\([\s\S]*HZY_DATA_RUNTIME_JWKS_URL/)
  })

  test('bootstrap endpoints use their own code or control-token authentication boundary', () => {
    const middleware = source('server/middleware/platform-access.ts')

    assert.match(middleware, /TENANT_RUNTIME_BOOTSTRAP_PATHS/)
    assert.match(middleware, /runtime-bootstrap/)
    assert.ok(middleware.indexOf('TENANT_RUNTIME_BOOTSTRAP_PATHS.has(path)') < middleware.indexOf('isRuntimeContractPath(path)'))
  })

  test('enrolled instance runtime tokens are accepted only for their bound deployment', () => {
    const auth = source('server/utils/runtimeAuth.ts')
    const verifier = source('server/utils/tenantRuntimeInstanceToken.ts')
    const enrollment = source('server/utils/tenantRuntimeEnrollment.ts')

    assert.match(auth, /isTenantRuntimeInstanceToken/)
    assert.match(auth, /verifyTenantRuntimeInstanceToken/)
    assert.match(auth, /deploymentId:\s*deployment\.id/)
    assert.match(verifier, /hzy_dr_/)
    assert.match(verifier, /tenant_runtime_instance_apps/)
    assert.match(verifier, /a\.deployment_id=\?/)
    assert.match(verifier, /runtime_token_hash=\?/)
    assert.doesNotMatch(verifier, /control_token_hash=\?/)
    assert.match(enrollment, /TENANT_RUNTIME_BINDING_APP_CODES\s*=\s*\[\s*'console'/)
    assert.match(enrollment, /const appCodes = \[\.\.\.TENANT_RUNTIME_BINDING_APP_CODES\]/)
    assert.match(enrollment, /isControlPlaneBinding \? 'schema_ready' : 'pending'/)
    assert.match(enrollment, /isControlPlaneBinding \? 'not_applicable' : 'unknown'/)
    assert.match(enrollment, /enabledApps: deployments\.filter\(item => item\.app_code !== 'console'\)/)
    assert.match(source('server/api/platform/tenant-admin/deployment-settings/install-command.post.ts'), /enabledApps: \['console', \.\.\.enrollment\.enabledApps\]/)
  })

  test('runtime heartbeat preserves the Console control-plane binding readiness', () => {
    const heartbeat = source('server/api/v1/runtime/agent-heartbeat.post.ts')

    assert.match(heartbeat, /app_code <> 'console'/)
    assert.match(heartbeat, /if \(appCode === 'console'\) continue/)
    assert.match(heartbeat, /deploymentBindings:\s*Object\.fromEntries/)
    assert.match(heartbeat, /platformSigningKey:\s*\{/)
    assert.match(heartbeat, /publicKey:\s*platformSigningKey\.publicKey/)
    assert.match(source('../data-runtime/cmd/hzy-data-runtime/control_heartbeat.go'), /writeDeploymentBindings/)
    assert.match(source('../data-runtime/cmd/hzy-data-runtime/control_heartbeat.go'), /writePlatformSigningKey/)
  })

  test('runtime heartbeat reconciles deployments added after enrollment before applying app readiness', () => {
    const heartbeat = source('server/api/v1/runtime/agent-heartbeat.post.ts')

    assert.match(heartbeat, /TENANT_RUNTIME_BINDING_APP_CODES/)
    assert.match(heartbeat, /INSERT INTO tenant_runtime_instance_apps/)
    assert.match(heartbeat, /FROM deployments/)
    assert.match(heartbeat, /tenant_code = \? AND environment = \?/)
    assert.match(heartbeat, /app_code IN \(\$\{bindingPlaceholders\}\)/)
    assert.match(heartbeat, /MAX\(id\) AS id/)
    assert.match(heartbeat, /ON DUPLICATE KEY UPDATE/)
    assert.match(heartbeat, /deployment_id = VALUES\(deployment_id\)/)
    assert.ok(
      heartbeat.indexOf('INSERT INTO tenant_runtime_instance_apps')
      < heartbeat.indexOf('UPDATE tenant_runtime_instance_apps')
    )
  })

  test('runtime heartbeat records a sanitized warning for active bindings that remain unavailable', () => {
    const heartbeat = source('server/api/v1/runtime/agent-heartbeat.post.ts')

    assert.match(heartbeat, /a\.status, a\.schema_status, a\.last_error_code/)
    assert.match(heartbeat, /bindingReadinessIssues/)
    assert.match(heartbeat, /\['schema_ready', 'active'\]\.includes\(item\.status\)/)
    assert.match(heartbeat, /\[tenant-runtime\] active app bindings are unavailable/)
    assert.match(heartbeat, /runtimeCode/)
    assert.match(heartbeat, /schemaStatus: item\.schema_status/)
    assert.doesNotMatch(heartbeat, /console\.(?:warn|error)\([^\n]*\bapps\b/)
  })

  test('Console Vault custody migrates server-to-server and retires Platform plaintext', () => {
    const route = source('server/api/platform/tenant-admin/deployment-settings/console-vault-migration.post.ts')
    const secrets = source('server/utils/deploymentBootstrapSecrets.ts')
    const runtime = source('../data-runtime/internal/server/console_vault_bootstrap.go')
    const artifacts = source('server/api/platform/_handlers/subscriptions/[appCode]/artifacts.get.ts')
    const licenseArtifacts = source('server/utils/licenseArtifacts.ts')
    const onboarding = source('server/utils/onboardingFlow.ts')

    assert.match(route, /requireTenantOwnerForTenantAdmin/)
    assert.match(route, /console-vault-bootstrap\.v1/)
    assert.match(route, /Buffer\.from\(payloadJSON\)\.toString\('base64url'\)/)
    assert.match(route, /AbortSignal\.timeout/)
    assert.match(route, /runtimeRejectionCode/)
    assert.match(route, /response\.text\(\)/)
    assert.equal(route.match(/\bvaultMasterKey:/g)?.length, 1)
    assert.match(secrets, /status = 'migrated'/)
    assert.match(secrets, /secret_last4 = NULL/)
    assert.match(secrets, /secret_value = \?/)
    assert.match(runtime, /ed25519\.Verify/)
    assert.match(runtime, /console_vault_bootstrap_binding_mismatch/)
    assert.match(runtime, /0600/)
    assert.match(runtime, /already_present/)
    assert.doesNotMatch(artifacts, /ensureConsoleVaultMasterKey/)
    assert.doesNotMatch(licenseArtifacts, /HZY_CONSOLE_VAULT_MASTER_KEY/)
    assert.doesNotMatch(onboarding, /`HZY_CONSOLE_VAULT_MASTER_KEY=/)
    const settings = source('server/api/platform/tenant-admin/deployment-settings.get.ts')
    const page = source('app/pages/dashboard/deployments.vue')
    assert.match(settings, /custody:\s*consoleVaultCustody\?\.status === 'migrated' \? 'tenant_runtime'/)
    assert.match(settings, /d\.app_code = 'console'/)
    assert.match(settings, /d\.status = 'active'/)
    assert.match(page, /migrateConsoleVaultMasterKey/)
    assert.match(page, /迁移 Vault 密钥/)
  })

  test('runtime version drift remains routable while operational checks stay healthy', () => {
    const heartbeat = source('server/api/v1/runtime/agent-heartbeat.post.ts')

    assert.match(heartbeat, /const runtimeReady = keyReady && databaseReady && endpointReady/)
    assert.match(heartbeat, /const status = runtimeReady \? 'ready' : 'unhealthy'/)
    assert.match(heartbeat, /else if \(!versionReady\) errorCode = 'runtime_version_incompatible'/)
    assert.doesNotMatch(heartbeat, /versionReady && keyReady && databaseReady && endpointReady \? 'ready'/)
  })

  test('gateway withholds runtime endpoints until operational checks and app schema are ready', () => {
    const content = source('server/api/platform/internal/tenant-gateway/resolve.get.ts')

    assert.match(content, /runtimeInstance\.status === 'ready'/)
    assert.match(content, /\['schema_ready', 'active'\]/)
    assert.match(content, /runtimeReady && bindingReady/)
    assert.match(content, /runtimeReady && allRuntimeAppsReady/)
  })
})
