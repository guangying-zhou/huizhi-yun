import assert from 'node:assert/strict'
import test from 'node:test'
import { createError } from 'h3'
import {
  assertNotificationPublisherIdentity,
  authorizeConsoleServiceActor,
  consoleServiceActorContext
} from '../server/utils/consoleServiceActor.ts'

function statusCode(error: unknown) {
  return Number((error as { statusCode?: unknown })?.statusCode || 0)
}

async function rejected(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    return error
  }
  assert.fail('expected operation to reject')
}

test('Console service actor accepts a verified active service credential', async () => {
  const actor = await authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'credential_vault',
    requiredScope: 'credential_vault:resolve',
    verify: async (token, audience) => {
      assert.equal(token, 'signed-token')
      assert.equal(audience, 'credential_vault')
      return {
        sub: 'client:notification-runtime',
        client_id: 'notification-runtime',
        token_use: 'service',
        scope: 'credential_vault:resolve',
        tenant: 'TENANT-A',
        deployment: 'DEPLOYMENT-A',
        hzy: { clientCode: 'notification-runtime', appCode: null }
      }
    }
  })

  assert.deepEqual(actor, {
    actorType: 'service',
    actorId: 'notification-runtime',
    appCode: null,
    tenantCode: 'TENANT-A',
    deploymentCode: 'DEPLOYMENT-A'
  })
})

test('verified service actor is projected into the Tenant Runtime command context', () => {
  assert.deepEqual(consoleServiceActorContext({
    actorType: 'service',
    actorId: 'connector-runtime.C000001-console',
    appCode: 'connector-runtime',
    tenantCode: 'C000001',
    deploymentCode: 'C000001-console'
  }, 'console:directory-profiles:sync', {
    authenticated: false,
    uid: 'untrusted-browser-user'
  }), {
    authenticated: true,
    uid: null,
    subjectType: 'service',
    tokenUse: 'service',
    appCode: 'connector-runtime',
    clientCode: 'connector-runtime.C000001-console',
    scopes: ['console:directory-profiles:sync'],
    tenant: 'C000001',
    deployment: 'C000001-console'
  })
})

test('Console service actor maps only explicit invalid or revoked credentials to 401', async () => {
  const invalid = await rejected(() => authorizeConsoleServiceActor({
    authorization: 'Bearer revoked-token',
    audience: 'credential_vault',
    requiredScope: 'credential_vault:resolve',
    verify: async () => {
      throw createError({ statusCode: 401, message: 'credential revoked' })
    }
  }))
  assert.equal(statusCode(invalid), 401)

  for (const failure of [
    new Error('database unavailable'),
    createError({ statusCode: 500, message: 'control plane unavailable' }),
    createError({ statusCode: 503, message: 'introspection unavailable' })
  ]) {
    const unavailable = await rejected(() => authorizeConsoleServiceActor({
      authorization: 'Bearer otherwise-valid-token',
      audience: 'credential_vault',
      requiredScope: 'credential_vault:resolve',
      verify: async () => { throw failure }
    }))
    assert.equal(statusCode(unavailable), 503)
    assert.equal((unavailable as Error).message, 'service_token_verification_unavailable')
  }
})

test('Console service actor keeps missing bearer and insufficient scope semantics', async () => {
  const missingBearer = await rejected(() => authorizeConsoleServiceActor({
    authorization: '',
    audience: 'credential_vault',
    requiredScope: 'credential_vault:resolve',
    verify: async () => assert.fail('verification should not run')
  }))
  assert.equal(statusCode(missingBearer), 401)

  const insufficientScope = await rejected(() => authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'credential_vault',
    requiredScope: 'credential_vault:resolve',
    verify: async () => ({ token_use: 'service', scope: 'integration_config:view' })
  }))
  assert.equal(statusCode(insufficientScope), 403)
})

test('notification publisher requires exact app, tenant, and deployment binding', () => {
  const binding = { tenantId: 'TENANT-A', deploymentId: 'DEPLOYMENT-A' }
  assert.deepEqual(assertNotificationPublisherIdentity({
    actorType: 'service',
    actorId: 'aims-runtime',
    appCode: 'aims',
    tenantCode: 'TENANT-A',
    deploymentCode: 'DEPLOYMENT-A'
  }, binding), {
    actorType: 'service',
    actorId: 'aims-runtime',
    appCode: 'aims',
    tenantCode: 'TENANT-A',
    deploymentCode: 'DEPLOYMENT-A'
  })

  for (const actor of [
    { appCode: null, tenantCode: 'TENANT-A', deploymentCode: 'DEPLOYMENT-A' },
    { appCode: 'aims', tenantCode: null, deploymentCode: 'DEPLOYMENT-A' },
    { appCode: 'aims', tenantCode: 'TENANT-B', deploymentCode: 'DEPLOYMENT-A' },
    { appCode: 'aims', tenantCode: 'TENANT-A', deploymentCode: 'DEPLOYMENT-B' }
  ]) {
    assert.throws(() => assertNotificationPublisherIdentity({
      actorType: 'service',
      actorId: 'aims-runtime',
      ...actor
    }, binding), error => statusCode(error) === 403)
  }
})

test('service actor rejects a single historical source claim as publisher identity and rejects claim drift', async () => {
  const actor = await authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'notifications',
    requiredScope: 'notifications:publish',
    verify: async () => ({
      token_use: 'service',
      scope: 'notifications:publish',
      source_app: 'aims',
      tenant: 'TENANT-A',
      deployment: 'DEPLOYMENT-A'
    })
  })
  assert.equal(actor.appCode, null)
  assert.throws(() => assertNotificationPublisherIdentity(actor, {
    tenantId: 'TENANT-A',
    deploymentId: 'DEPLOYMENT-A'
  }), error => statusCode(error) === 403)

  const drift = await rejected(() => authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'notifications',
    requiredScope: 'notifications:publish',
    verify: async () => ({
      token_use: 'service',
      scope: 'notifications:publish',
      source_app: 'workflow',
      hzy: { appCode: 'aims' }
    })
  }))
  assert.equal(statusCode(drift), 401)
})

test('modern dual-claim service token becomes an exact notification publisher', async () => {
  const actor = await authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'notifications',
    requiredScope: 'notifications:publish',
    verify: async () => ({
      sub: 'client:aims-runtime',
      token_use: 'service',
      scope: 'notifications:publish',
      source_app: 'aims',
      tenant: 'TENANT-A',
      deployment: 'DEPLOYMENT-A',
      hzy: { clientCode: 'aims-runtime', appCode: 'aims' }
    })
  })
  assert.equal(assertNotificationPublisherIdentity(actor, {
    tenantId: 'TENANT-A',
    deploymentId: 'DEPLOYMENT-A'
  }).appCode, 'aims')
})

test('eligibility service identity uses the Console audience and requires its exact target_app claim', async () => {
  for (const targetApp of [undefined, 'notifications']) {
    const error = await rejected(() => authorizeConsoleServiceActor({
      authorization: 'Bearer signed-token',
      audience: 'console',
      requiredScope: 'console:authorization:subject-eligibility',
      requireBoundTargetApp: true,
      verify: async () => ({
        token_use: 'service',
        scope: 'console:authorization:subject-eligibility',
        source_app: 'assets',
        target_app: targetApp,
        tenant: 'TENANT-A',
        deployment: 'DEPLOYMENT-A',
        hzy: { appCode: 'assets' }
      })
    }))
    assert.equal(statusCode(error), 401)
  }

  const actor = await authorizeConsoleServiceActor({
    authorization: 'Bearer signed-token',
    audience: 'console',
    requiredScope: 'console:authorization:subject-eligibility',
    requireBoundTargetApp: true,
    verify: async () => ({
      token_use: 'service',
      scope: 'console:authorization:subject-eligibility',
      source_app: 'assets',
      target_app: 'console',
      tenant: 'TENANT-A',
      deployment: 'DEPLOYMENT-A',
      hzy: { appCode: 'assets' }
    })
  })
  assert.equal(actor.appCode, 'assets')
})
