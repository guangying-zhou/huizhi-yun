import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { decodeProtectedHeader, generateKeyPair, jwtVerify } from 'jose'
import {
  bindServiceAccessTokenPolicyToServiceClient,
  bindServiceAccessTokenPolicyToTrustedSource,
  signServiceAccessTokenWithContext
} from '../server/utils/serviceAccessTokenClaims.ts'

const source = readFileSync(
  new URL('../../data-runtime/internal/apps/console/auth_service_tokens.go', import.meta.url),
  'utf8'
)
const peopleGrantSeed = readFileSync(
  new URL('../docs/sql/Console-SQL-Seed-v1.38-console-runtime-people-notification-details.sql', import.meta.url),
  'utf8'
)
const peopleGrantVerify = readFileSync(
  new URL('../docs/sql/Console-SQL-Verify-v1.38-console-runtime-people-notification-details.sql', import.meta.url),
  'utf8'
)
const financeGrantSeed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.39-console-runtime-finance-notification-details.sql', import.meta.url), 'utf8')
const financeGrantVerify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v1.39-console-runtime-finance-notification-details.sql', import.meta.url), 'utf8')
const altocGrantSeed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.40-console-runtime-altoc-notification-details.sql', import.meta.url), 'utf8')
const altocGrantVerify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v1.40-console-runtime-altoc-notification-details.sql', import.meta.url), 'utf8')
const peopleAssetsGrantSeed = readFileSync(new URL('../docs/sql/Console-SQL-Seed-v1.41-people-assets-offboarding-recovery.sql', import.meta.url), 'utf8')
const peopleAssetsGrantVerify = readFileSync(new URL('../docs/sql/Console-SQL-Verify-v1.41-people-assets-offboarding-recovery.sql', import.meta.url), 'utf8')

test('Console runtime bootstrap is idempotent and never exposes credential plaintext', () => {
  assert.match(source, /ON DUPLICATE KEY UPDATE/)
  assert.match(source, /LIMIT 1 FOR UPDATE/)
  assert.match(source, /'db_encrypted'/)
  assert.match(source, /svc\.console\.runtime\.client_secret/)
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^)]*secret/i)
  assert.doesNotMatch(source, /return\s+\{[^}]*secret\b/is)

  for (const scope of [
    'data-runtime:runtime:update',
    'notification-runtime:send',
    'tenant-runtime:runtime:update',
    'webdev:issue:read',
    'webdev:issue:write',
    'aims:notification-details:authorize',
    'assets:notification-details:authorize',
    'altoc:notification-details:authorize',
    'finance:notification-details:authorize',
    'people:notification-details:authorize',
    'workflow:action_defs:sync',
    'workflow:notification-details:authorize',
    'workflow:proxy'
  ]) {
    assert.match(source, new RegExp(`['"]${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`))
  }
})

test('v1.40 Altoc notification-detail grant is repeatable, secret-free, and verified', () => {
  assert.match(altocGrantSeed, /altoc:notification-details['`]?\s*,\s*['`]?authorize/)
  assert.match(altocGrantSeed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(altocGrantSeed, /INSERT\s+INTO\s+`?service_client_credentials`?/i)
  assert.doesNotMatch(altocGrantSeed, /INSERT\s+INTO\s+`?vault_secret_versions`?/i)
  assert.match(altocGrantVerify, /altoc:notification-details:authorize/)
})

test('v1.41 People Assets offboarding grant is exact, repeatable, and secret-free', () => {
  assert.match(peopleAssetsGrantSeed, /assets:offboarding-recovery['`]?\s*,\s*['`]?sync/)
  assert.match(peopleAssetsGrantSeed, /app_code`?\s*=\s*'people'/)
  assert.match(peopleAssetsGrantSeed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(peopleAssetsGrantSeed, /INSERT\s+INTO\s+`?service_client_credentials`?/i)
  assert.doesNotMatch(peopleAssetsGrantSeed, /INSERT\s+INTO\s+`?vault_secret_versions`?/i)
  assert.match(peopleAssetsGrantVerify, /assets:offboarding-recovery:sync/)
})

test('v1.39 Finance notification-detail grant is repeatable, secret-free, and verified', () => {
  assert.match(financeGrantSeed, /finance:notification-details['`]?\s*,\s*['`]?authorize/)
  assert.match(financeGrantSeed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(financeGrantSeed, /INSERT\s+INTO\s+`?service_client_credentials`?/i)
  assert.doesNotMatch(financeGrantSeed, /INSERT\s+INTO\s+`?vault_secret_versions`?/i)
  assert.match(financeGrantVerify, /finance:notification-details:authorize/)
})

test('v1.38 People notification-detail grant is repeatable, secret-free, and verified', () => {
  assert.match(peopleGrantSeed, /people:notification-details['`]?\s*,\s*['`]?authorize/)
  assert.match(peopleGrantSeed, /ON DUPLICATE KEY UPDATE/)
  assert.doesNotMatch(peopleGrantSeed, /INSERT\s+INTO\s+`?service_client_credentials`?/i)
  assert.doesNotMatch(peopleGrantSeed, /INSERT\s+INTO\s+`?vault_secret_versions`?/i)
  assert.match(peopleGrantVerify, /people:notification-details:authorize/)
  assert.match(peopleGrantVerify, /<> 11 THEN 'FAIL_GRANTS'/)
})

test('production service-token signer emits real Console runtime identity claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA')
  const now = Math.floor(Date.now() / 1000)
  const token = await signServiceAccessTokenWithContext({
    audience: 'notification-runtime',
    scope: 'notification-runtime:send',
    expiresIn: 900,
    serviceClient: {
      clientId: 'console.runtime',
      clientCode: 'console.runtime',
      clientName: 'Console Runtime',
      clientType: 'runtime',
      appCode: 'console',
      credentialId: 73
    }
  }, {
    issuer: 'https://console.example.test',
    now,
    tenantCode: 'TENANT-A',
    deploymentCode: 'DEPLOYMENT-A',
    policyVersion: 'policy-v4',
    caps: 'bundle-sha256',
    signingKey: { alg: 'EdDSA', kid: 'console-key', key: privateKey }
  })

  assert.deepEqual(decodeProtectedHeader(token), {
    alg: 'EdDSA',
    kid: 'console-key',
    typ: 'JWT'
  })
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: 'https://console.example.test',
    audience: 'notification-runtime'
  })
  assert.equal(payload.sub, 'client:console.runtime')
  assert.equal(payload.client_id, 'console.runtime')
  assert.equal(payload.azp, 'console.runtime')
  assert.equal(payload.token_use, 'service')
  assert.equal(payload.scope, 'notification-runtime:send')
  assert.equal(payload.source_app, 'console')
  assert.equal(payload.target_app, 'notification-runtime')
  assert.equal(payload.tenant, 'TENANT-A')
  assert.equal(payload.deployment, 'DEPLOYMENT-A')
  assert.deepEqual(payload.hzy, {
    subjectType: 'service',
    subjectCode: 'console.runtime',
    clientCode: 'console.runtime',
    clientName: 'Console Runtime',
    clientType: 'runtime',
    appCode: 'console',
    credentialId: 73
  })
})

test('service-token deployment follows the trusted caller deployment instead of the Console deployment', () => {
  const policy = {
    tenantCode: 'C000001',
    deploymentCode: 'C000001-console',
    policyVersion: 'policy-v4',
    caps: 'bundle-sha256'
  }

  assert.deepEqual(bindServiceAccessTokenPolicyToTrustedSource({
    policy,
    serviceClientAppCode: 'codocs',
    trustedSource: {
      tenantCode: 'C000001',
      deploymentCode: 'C000001-codocs',
      appCode: 'codocs'
    }
  }), {
    ...policy,
    deploymentCode: 'C000001-codocs'
  })

  assert.throws(() => bindServiceAccessTokenPolicyToTrustedSource({
    policy,
    serviceClientAppCode: 'codocs',
    trustedSource: {
      tenantCode: 'C000002',
      deploymentCode: 'C000002-codocs',
      appCode: 'codocs'
    }
  }), /tenant does not match/)

  assert.throws(() => bindServiceAccessTokenPolicyToTrustedSource({
    policy,
    serviceClientAppCode: 'codocs',
    trustedSource: {
      tenantCode: 'C000001',
      deploymentCode: 'C000001-aims',
      appCode: 'aims'
    }
  }), /app does not match/)

  assert.throws(() => bindServiceAccessTokenPolicyToTrustedSource({
    policy,
    serviceClientAppCode: 'codocs',
    trustedSource: {
      tenantCode: 'C000001',
      deploymentCode: '',
      appCode: 'codocs'
    }
  }), /binding is incomplete/)
})

test('explicit service-client policy binds only an exact runtime client to its canonical app deployment', () => {
  const policy = {
    tenantCode: 'C000001',
    deploymentCode: 'C000001-console',
    policyVersion: 'policy-v4',
    caps: 'bundle-sha256'
  }

  assert.deepEqual(bindServiceAccessTokenPolicyToServiceClient({
    policy,
    serviceClientAppCode: 'codocs',
    serviceClientCode: 'codocs.runtime'
  }), {
    ...policy,
    deploymentCode: 'C000001-codocs'
  })
  assert.throws(() => bindServiceAccessTokenPolicyToServiceClient({
    policy,
    serviceClientAppCode: 'codocs',
    serviceClientCode: 'codocs'
  }), /exact runtime client/)
  assert.throws(() => bindServiceAccessTokenPolicyToServiceClient({
    policy: { ...policy, tenantCode: null },
    serviceClientAppCode: 'codocs',
    serviceClientCode: 'codocs.runtime'
  }), /exact runtime client/)
  assert.deepEqual(bindServiceAccessTokenPolicyToServiceClient({
    policy: { ...policy, tenantCode: null, deploymentCode: null },
    serviceClientAppCode: 'codocs',
    serviceClientCode: 'codocs.runtime',
    trustedSource: {
      tenantCode: 'C000001',
      deploymentCode: 'C000001-aims',
      appCode: 'aims'
    }
  }), {
    ...policy,
    tenantCode: 'C000001',
    deploymentCode: 'C000001-codocs'
  })
  assert.throws(() => bindServiceAccessTokenPolicyToServiceClient({
    policy,
    serviceClientAppCode: 'codocs',
    serviceClientCode: 'codocs.runtime',
    trustedSource: {
      tenantCode: 'C000002',
      deploymentCode: 'C000002-aims',
      appCode: 'aims'
    }
  }), /tenant does not match/)

  assert.deepEqual(bindServiceAccessTokenPolicyToServiceClient({
    policy,
    serviceClientAppCode: 'connector-runtime',
    serviceClientCode: 'connector-runtime.C000001-console',
    trustedSource: {
      tenantCode: 'C000001',
      deploymentCode: 'C000001-console',
      appCode: 'connector-runtime'
    }
  }), {
    ...policy,
    deploymentCode: 'C000001-console'
  })
})

test('runtime client policy preserves exact test deployment and rejects incomplete or cross-tenant binding', () => {
  const policy = { tenantCode: 'C000001', deploymentCode: 'wiztek-test-console', policyVersion: 'test', caps: '' }
  for (const appCode of ['assets', 'aims', 'finance']) {
    const input = { policy, serviceClientAppCode: appCode, serviceClientCode: `${appCode}.runtime`, trustedSource: { tenantCode: 'C000001', deploymentCode: `C000001-test-${appCode}`, appCode } }
    assert.equal(bindServiceAccessTokenPolicyToServiceClient(input).deploymentCode, `C000001-test-${appCode}`)
    assert.throws(() => bindServiceAccessTokenPolicyToServiceClient({ ...input, trustedSource: { ...input.trustedSource, deploymentCode: '' } }), /exact deployment/)
    assert.throws(() => bindServiceAccessTokenPolicyToServiceClient({ ...input, trustedSource: { ...input.trustedSource, tenantCode: 'C000002' } }), /tenant does not match/)
  }
})
