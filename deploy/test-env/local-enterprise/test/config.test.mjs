import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { localServiceTenant, validateProfile } from '../config.mjs'
import { buildForwardHeaders } from '../../../cloudflare/tenant-gateway/src/index.js'

test('only the private company summary mode publishes the exact Codocs deployment in the trusted route catalog', () => {
  const tenant = { tenantCode: 'C000001', environment: 'test', apps: { console: { deploymentCode: 'wiztek-test-console' } } }
  const catalog = features => {
    const headers = buildForwardHeaders(new Request('https://hzy0.isme.dev/console/oauth/token'), {},
      localServiceTenant(tenant, 'C000001-test-enterprise', features), '/console/', 'console')
    return JSON.parse(headers.get('x-hzy-service-routes') || '{}')
  }
  assert.equal(catalog({ workflowLocal: true }).codocs, undefined)
  assert.equal(catalog({ companySummaryCodocsDelivery: true }).codocs, undefined)
  assert.deepEqual(catalog({ workflowLocal: true, companySummaryCodocsDelivery: true }).codocs,
    { origin: 'https://codocs.isme.dev', deploymentCode: 'C000001-test-codocs', basePath: '/codocs/' })
})

const example = JSON.parse(readFileSync(resolve('deploy/test-env/local-enterprise/profile.example.json'), 'utf8'))

test('read-only phase rejects an egress port the Host adapter cannot use', () => {
  const profile = approvedProfile()
  profile.listeners.gatewayInternal.port = 23421
  assert.ok(validateProfile(profile).some(issue => issue.includes('gatewayInternal.port must be 23121')))
})

test('Codocs editor binds only its pinned loopback listener', () => {
  const profile = approvedProfile()
  profile.listeners.codocsEditor.port = 23430
  assert.ok(validateProfile(profile).some(issue => issue.includes('codocsEditor.port must be 23130')))
})

test('v2 collaboration requires snapshot v2, the local Console facade and a pinned Collab listener', () => {
  const profile = approvedProfile()
  profile.features.codocsCollaborationV2 = true
  let issues = validateProfile(profile)
  assert.ok(issues.some(issue => issue.includes('requires codocsSnapshotV2')))
  assert.ok(issues.some(issue => issue.includes('requires the local Console facade')))
  assert.ok(issues.some(issue => issue.includes('listeners.collab must be 127.0.0.1:23131')))
  profile.features.codocsSnapshotV2 = true
  profile.identity.consoleFacadeMode = 'local-canonical-facade'
  profile.identity.credentialProviderRef = 'protected-file:test-gateway'
  profile.listeners.collab = { host: '127.0.0.1', port: 23131 }
  assert.deepEqual(validateProfile(profile), [])
  profile.listeners.collab.port = 23132
  assert.ok(validateProfile(profile).some(issue => issue.includes('listeners.collab must be 127.0.0.1:23131')))
})

test('local Workflow requires the pinned private listener and local Console facade', () => {
  const profile = approvedProfile()
  profile.features.workflowLocal = true
  let issues = validateProfile(profile)
  assert.ok(issues.some(issue => issue.includes('workflowLocal requires the local Console facade')))
  assert.ok(issues.some(issue => issue.includes('listeners.workflow must be 127.0.0.1:23140')))
  assert.ok(issues.some(issue => issue.includes('listeners.aims must be 127.0.0.1:23141')))
  profile.identity.consoleFacadeMode = 'local-canonical-facade'
  profile.identity.credentialProviderRef = 'protected-file:test-gateway'
  profile.runtime.transportMode = 'loopback'
  profile.runtime.dialEndpoint = 'http://127.0.0.1:18084'
  profile.listeners.workflow = { host: '127.0.0.1', port: 23140 }
  profile.listeners.aims = { host: '127.0.0.1', port: 23141 }
  assert.deepEqual(validateProfile(profile), [])
  profile.listeners.workflow.port = 23141
  assert.ok(validateProfile(profile).some(issue => issue.includes('listeners.workflow must be 127.0.0.1:23140')))
  profile.listeners.workflow.port = 23140
  profile.listeners.aims.port = 23142
  assert.ok(validateProfile(profile).some(issue => issue.includes('listeners.aims must be 127.0.0.1:23141')))
})

test('company summary Codocs delivery requires the reviewed local stack and target deployment', () => {
  const profile = approvedProfile()
  profile.features.companySummaryCodocsDelivery = true
  assert.ok(validateProfile(profile).some(issue => issue.includes('requires workflowLocal')))
  profile.features.workflowLocal = true
  profile.listeners.workflow = { host: '127.0.0.1', port: 23140 }
  profile.listeners.aims = { host: '127.0.0.1', port: 23141 }
  profile.runtime.transportMode = 'loopback'
  profile.runtime.dialEndpoint = 'http://127.0.0.1:18084'
  profile.identity.consoleFacadeMode = 'local-canonical-facade'
  profile.identity.credentialProviderRef = 'protected-file:test-gateway'
  profile.identity.codocsDeployment = 'C000001-test-codocs'
  assert.deepEqual(validateProfile(profile), [])
  profile.identity.codocsDeployment = 'C000001-test-aims'
  assert.ok(validateProfile(profile).some(issue => issue.includes('identity.codocsDeployment')))
})

function approvedProfile() {
  return {
    ...structuredClone(example),
    runtime: {
      ...example.runtime,
      expectedTenant: 'C000001',
      expectedRuntimeCode: 'c000001-test-tenant-runtime',
      expectedRuntimeDeployment: 'c000001-test-tenant-runtime'
    },
    identity: {
      ...example.identity,
      decisionStatus: 'APPROVED_EXISTING_CANONICAL_CONSOLE',
      canonicalIssuer: 'https://hzy-test.huizhi.yun',
      canonicalJwksUri: 'https://hzy-test.huizhi.yun/.well-known/jwks.json',
      enterpriseDeployment: 'C000001-test-enterprise',
      enterpriseOidcClientId: 'enterprise',
      enterpriseServiceClientId: 'enterprise.runtime',
      consoleDeployment: 'wiztek-test-console',
      credentialProviderRef: 'macos-keychain:hzy0'
    },
    security: {
      ...example.security,
      outerAccessProtectionVerified: true,
      gatewayCredentialRef: 'macos-keychain:hzy0-gateway'
    },
    processManagement: {
      ...example.processManagement,
      pm2Home: '/Users/example/.local/state/huizhi-yun/hzy0/pm2'
    }
  }
}

test('approved public Runtime profile passes strict validation', () => {
  assert.deepEqual(validateProfile(approvedProfile()), [])
})

test('profile rejects unknown and unsafe configuration before startup', () => {
  const profile = approvedProfile()
  profile.runtime.dialEndpoint = 'http://127.0.0.1:18084'
  profile.unknown = true
  profile.security.effectiveRuntimeBypass = true
  const issues = validateProfile(profile)
  assert.ok(issues.includes('profile.unknown is not allowed'))
  assert.ok(issues.includes('runtime.dialEndpoint must be null for public-https'))
  assert.ok(issues.includes('security.effectiveRuntimeBypass must be false'))
})

test('loopback Runtime requires an explicit loopback dial endpoint', () => {
  const profile = approvedProfile()
  profile.runtime.transportMode = 'loopback'
  profile.runtime.dialEndpoint = 'https://runtime.example.test'
  assert.ok(validateProfile(profile).includes('runtime.dialEndpoint must be the pinned loopback Runtime'))
})

test('only the pinned Runtime loopback address is accepted', () => {
  const profile = approvedProfile()
  profile.runtime.transportMode = 'loopback'
  profile.runtime.dialEndpoint = 'http://127.0.0.1:18084'
  assert.deepEqual(validateProfile(profile), [])
  for (const dialEndpoint of ['http://localhost:18084', 'http://127.0.0.1:18084/', 'http://127.0.0.1:18085']) {
    profile.runtime.dialEndpoint = dialEndpoint
    assert.ok(validateProfile(profile).includes('runtime.dialEndpoint must be the pinned loopback Runtime'))
  }
})

test('origin variants and global PM2 home cannot pass as approved local profile', () => {
  for (const origin of ['https://user:pass@hzy0.isme.dev','https://hzy0.isme.dev:8443','https://hzy0.isme.dev/?x=1','https://hzy0.isme.dev/#x']) {
    const profile=approvedProfile();profile.publicOrigin=origin
    assert.ok(validateProfile(profile).some(issue=>issue.startsWith('publicOrigin')))
  }
  for (const home of ['/','/Users/example/.pm2','/workspace']) {
    const profile=approvedProfile();profile.processManagement.pm2Home=home
    assert.ok(validateProfile(profile).some(issue=>issue.startsWith('processManagement.pm2Home')))
  }
})

test('optional features accept only known boolean switches', () => {
  const base = approvedProfile()
  assert.deepEqual(validateProfile(base).filter(issue => issue.includes('features')), [])
  for (const [features, ok] of [
    [{ codocsSnapshotV2: true }, true],
    [{ codocsSnapshotV2: false }, true],
    [{ codocsSnapshotV2: true, codocsCollaborationV2: true }, true],
    [{ codocsSnapshotV2: true, codocsCollaborationV2: true, codocsDepartmentCollaborationV2: true }, true],
    [{ codocsSnapshotV2: true, codocsCollaborationV2: true, codocsDepartmentCollaborationV2: 'true' }, false],
    [{ codocsSnapshotV2: true, codocsDepartmentCollaborationV2: true }, false],
    [{ notificationsInAppOnly: true }, false],
    [{}, true],
    [{ codocsSnapshotV2: 'true' }, false],
    [{ notificationsInAppOnly: 'true' }, false],
    [{ other: true }, false],
    [[], false],
    [null, false]
  ]) {
    const profile = approvedProfile()
    profile.features = features
    assert.equal(validateProfile(profile).some(issue => issue.includes('features')), !ok, JSON.stringify(features))
  }
})

test('in-app-only notifications require the local Console egress binding', () => {
  const profile = approvedProfile()
  profile.features.notificationsInAppOnly = true
  assert.ok(validateProfile(profile).some(issue => issue.includes('requires the local Console egress')))
  profile.identity.consoleFacadeMode = 'local-canonical-facade'
  profile.identity.credentialProviderRef = 'protected-file:test-gateway'
  assert.deepEqual(validateProfile(profile), [])
})
