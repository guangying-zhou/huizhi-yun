import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH,
  AIMS_PROJECT_CABINET_READ_SERVICE_AUTH,
  WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH,
  requireCodocsCrossAppServiceTenantDeploymentBinding,
  requireCodocsServiceAuth,
  requireCodocsServiceTenantDeploymentBinding
} from '../server/lib/serviceAuthPolicy.ts'

function assertHTTPError(statusCode: number, message: RegExp) {
  return (error: unknown) => {
    const value = error as { statusCode?: number, message?: string }
    assert.equal(value.statusCode, statusCode)
    assert.match(String(value.message || ''), message)
    return true
  }
}

describe('Altoc to Codocs ops-knowledge service auth', () => {
  const validAuth = {
    authenticated: true,
    tokenUse: 'service',
    subjectType: 'service',
    appCode: 'altoc',
    clientCode: 'altoc.runtime',
    scopes: ['codocs:documents:write']
  }

  async function invokeAfterAuth(auth: Parameters<typeof requireCodocsServiceAuth>[0], next: () => unknown) {
    requireCodocsServiceAuth(auth, ALTOC_OPS_KNOWLEDGE_SERVICE_AUTH)
    return await next()
  }

  test('rejects unauthenticated callers before invoking the link handler', async () => {
    let calls = 0
    await assert.rejects(
      () => invokeAfterAuth({ ...validAuth, authenticated: false }, () => {
        calls += 1
      }),
      assertHTTPError(401, /service token is required/i)
    )
    assert.equal(calls, 0)
  })

  test('keeps expired or revoked service identity at 401 before invoking the link handler', async () => {
    for (const reason of ['invalid_token', 'revoked_service_token']) {
      let calls = 0
      const inactiveAuth = { ...validAuth, authenticated: false, reason }
      await assert.rejects(
        () => invokeAfterAuth(inactiveAuth, () => {
          calls += 1
        }),
        assertHTTPError(401, /service token is required/i)
      )
      assert.equal(calls, 0)
    }
  })

  test('preserves Console introspection outages as 503 before invoking the link handler', async () => {
    let calls = 0
    const unavailableAuth = {
      ...validAuth,
      authenticated: false,
      reason: 'service_token_introspection_unavailable'
    }
    await assert.rejects(
      () => invokeAfterAuth(unavailableAuth, () => {
        calls += 1
      }),
      assertHTTPError(503, /introspection.*unavailable/i)
    )
    assert.equal(calls, 0)
  })

  test('rejects missing capability before invoking the link handler', async () => {
    let calls = 0
    await assert.rejects(
      () => invokeAfterAuth({ ...validAuth, scopes: ['codocs:documents:read'] }, () => {
        calls += 1
      }),
      assertHTTPError(403, /missing required service scope/i)
    )
    assert.equal(calls, 0)
  })

  test('rejects the wrong source application before invoking the link handler', async () => {
    let calls = 0
    await assert.rejects(
      () => invokeAfterAuth({ ...validAuth, appCode: 'aims' }, () => {
        calls += 1
      }),
      assertHTTPError(403, /caller is not allowed/i)
    )
    assert.equal(calls, 0)
  })

  test('allows the verified Altoc service caller and invokes the link handler once', async () => {
    let calls = 0
    const result = await invokeAfterAuth(validAuth, () => {
      calls += 1
      return { linked: true }
    })
    assert.deepEqual(result, { linked: true })
    assert.equal(calls, 1)
  })
})

describe('Aims project cabinet exact service capability', () => {
  const validAuth = {
    authenticated: true,
    tokenUse: 'service',
    subjectType: 'service',
    appCode: 'aims',
    clientCode: 'aims.runtime',
    scopes: ['codocs:project-cabinet:read'],
    tenant: 'tenant-a',
    deployment: 'prod-a'
  }

  test('requires the exact capability instead of Codocs wildcard capabilities', () => {
    for (const scopes of [['codocs:*'], ['codocs:admin'], ['codocs:documents:read']]) {
      assert.throws(
        () => requireCodocsServiceAuth({ ...validAuth, scopes }, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH),
        assertHTTPError(403, /missing required service scope/i)
      )
    }
  })

  test('requires both the Aims app identity and approved Aims client code', () => {
    assert.throws(
      () => requireCodocsServiceAuth({ ...validAuth, appCode: 'altoc' }, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH),
      assertHTTPError(403, /caller is not allowed/i)
    )
    assert.throws(
      () => requireCodocsServiceAuth({ ...validAuth, clientCode: 'aims.worker' }, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH),
      assertHTTPError(403, /client is not allowed/i)
    )
  })

  test('preserves inactive and introspection outage distinctions', () => {
    assert.throws(
      () => requireCodocsServiceAuth({ ...validAuth, authenticated: false, reason: 'revoked_service_token' }, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH),
      assertHTTPError(401, /service token is required/i)
    )
    assert.throws(
      () => requireCodocsServiceAuth({ ...validAuth, authenticated: false, reason: 'service_token_introspection_unavailable' }, AIMS_PROJECT_CABINET_READ_SERVICE_AUTH),
      assertHTTPError(503, /introspection.*unavailable/i)
    )
  })
})

describe('Workflow publish callback tenant/deployment binding', () => {
  const validAuth = {
    authenticated: true,
    tokenUse: 'service',
    subjectType: 'service',
    appCode: 'workflow',
    clientCode: 'workflow.runtime',
    scopes: ['workflow:callback'],
    tenant: 'tenant-a',
    deployment: 'prod-a'
  }

  test('accepts only the exact service token tenant and deployment', () => {
    requireCodocsServiceAuth(validAuth, WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH)
    assert.deepEqual(requireCodocsServiceTenantDeploymentBinding(validAuth, 'tenant-a', 'prod-a'), { tenant: 'tenant-a', deployment: 'prod-a' })
  })

  test('fails closed for missing or mismatched trusted request context', () => {
    for (const [tenant, deployment] of [['', 'prod-a'], ['tenant-a', ''], ['tenant-b', 'prod-a'], ['tenant-a', 'prod-b']]) {
      assert.throws(
        () => requireCodocsServiceTenantDeploymentBinding(validAuth, tenant, deployment),
        assertHTTPError(403, /tenant\/deployment binding is invalid/i)
      )
    }
  })
})

describe('cross-app source and target deployment binding', () => {
  const validAuth = {
    authenticated: true,
    tokenUse: 'service',
    subjectType: 'service',
    appCode: 'aims',
    clientCode: 'aims.runtime',
    scopes: ['codocs:company-weekly-summary:publish'],
    tenant: 'tenant-a',
    deployment: 'aims-prod'
  }

  test('keeps the token source deployment separate from the routed target deployment', () => {
    assert.deepEqual(
      requireCodocsCrossAppServiceTenantDeploymentBinding(validAuth, 'tenant-a', 'codocs-prod'),
      { tenant: 'tenant-a', sourceDeployment: 'aims-prod', targetDeployment: 'codocs-prod' }
    )
  })

  test('fails closed when tenant or either deployment is unavailable', () => {
    for (const [auth, tenant, target] of [
      [{ ...validAuth, deployment: '' }, 'tenant-a', 'codocs-prod'],
      [validAuth, '', 'codocs-prod'],
      [validAuth, 'tenant-b', 'codocs-prod'],
      [validAuth, 'tenant-a', '']
    ] as const) {
      assert.throws(
        () => requireCodocsCrossAppServiceTenantDeploymentBinding(auth, tenant, target),
        assertHTTPError(403, /cross-app service tenant\/deployment binding is invalid/i)
      )
    }
  })
})
