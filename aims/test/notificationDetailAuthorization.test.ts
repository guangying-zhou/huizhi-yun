import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  requireAimsNotificationAuthorizationChallenge,
  requireAimsNotificationAuthorizationDecisionBinding,
  requireAimsNotificationDetailAuthorizationResult,
  requireAimsNotificationDetailFinalizeResult,
  requireAimsIntegrationOperationNotificationDescriptor,
  parseAimsNotificationFinalizeBinding
} from '../server/utils/notificationDetailAuthorizationResult.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const descriptor = { resource: 'work_item', id: '42' }
const integrationOperationId = '90b90bf3-5899-4aed-98c8-23dd1897f463'
const integrationOperationDescriptor = { resource: 'integration_operation', id: integrationOperationId }
const factsHash = 'a'.repeat(64)
const objectRevision = 'b'.repeat(64)

function challenge() {
  return {
    appCode: 'aims' as const,
    resourceCode: 'projects' as const,
    action: 'admin' as const,
    objectRevision,
    factsHash,
    object: {
      projectCode: 'PRJ-9',
      projectId: '9',
      departmentCode: 'DEPT-A',
      confidentialityLevel: 'L2' as const
    }
  }
}

function decision() {
  return {
    allowed: true as const,
    appCode: 'aims' as const,
    resourceCode: 'projects' as const,
    action: 'admin' as const,
    factsHash,
    policyRevision: 17,
    policyBundleHash: 'bundle-hash-17',
    scopeBasis: ['department', 'project_code'] as const
  }
}

describe('Aims notification detail authorization', () => {
  test('accepts only an exact runtime-proven direct relation result', () => {
    assert.deepEqual(requireAimsNotificationDetailAuthorizationResult({
      authorized: true,
      reasonCode: 'allowed',
      resource: 'work_item',
      id: '42'
    }, descriptor), {
      authorized: true,
      reasonCode: 'allowed',
      resource: 'work_item',
      id: '42'
    })

    assert.throws(() => requireAimsNotificationDetailAuthorizationResult({
      authorized: true,
      reasonCode: 'allowed',
      resource: 'work_item',
      id: '42',
      projectCode: 'request-injected'
    }, descriptor), error => Number((error as { statusCode?: number }).statusCode) === 503)
  })

  test('integration operation descriptor and result expose only the exact current decision tuple', () => {
    assert.deepEqual(
      requireAimsIntegrationOperationNotificationDescriptor(integrationOperationDescriptor),
      integrationOperationDescriptor
    )
    assert.deepEqual(requireAimsNotificationDetailAuthorizationResult({
      authorized: true,
      reasonCode: 'allowed',
      ...integrationOperationDescriptor
    }, integrationOperationDescriptor), {
      authorized: true,
      reasonCode: 'allowed',
      ...integrationOperationDescriptor
    })
    for (const reasonCode of ['not_found', 'not_recipient', 'stale_notification']) {
      assert.deepEqual(requireAimsNotificationDetailAuthorizationResult({
        authorized: false,
        reasonCode,
        ...integrationOperationDescriptor
      }, integrationOperationDescriptor), {
        authorized: false,
        reasonCode,
        ...integrationOperationDescriptor
      })
    }
  })

  test('integration operation authorization fails closed on binding drift or sensitive evidence', () => {
    for (const invalidDescriptor of [
      { ...integrationOperationDescriptor, id: 'not-a-uuid' },
      { ...integrationOperationDescriptor, id: '90b90bf3-5899-1aed-98c8-23dd1897f463' },
      { ...integrationOperationDescriptor, sourceApp: 'aims' }
    ]) assert.throws(() => requireAimsIntegrationOperationNotificationDescriptor(invalidDescriptor))

    for (const invalidResult of [
      { authorized: true, reasonCode: 'allowed', ...integrationOperationDescriptor, recipientUids: ['u1'] },
      { authorized: true, reasonCode: 'allowed', ...integrationOperationDescriptor, generation: 2 },
      { authorized: true, reasonCode: 'allowed', ...integrationOperationDescriptor, tenantCode: 't1' },
      { authorized: false, reasonCode: 'allowed', ...integrationOperationDescriptor },
      { authorized: false, reasonCode: 'not_recipient', ...integrationOperationDescriptor, notificationId: 'n1' },
      { authorized: true, reasonCode: 'allowed', resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f464' }
    ]) assert.throws(() => requireAimsNotificationDetailAuthorizationResult(invalidResult, integrationOperationDescriptor))
  })

  test('accepts a minimal source challenge and rejects relationship or actor leakage', () => {
    assert.deepEqual(requireAimsNotificationAuthorizationChallenge(challenge()), challenge())
    for (const extra of ['actorUid', 'ownerUid', 'projectOwnerUid', 'projectMemberUids', 'matchedRelations']) {
      assert.throws(
        () => requireAimsNotificationAuthorizationChallenge({
          ...challenge(),
          object: { ...challenge().object, [extra]: 'leak' }
        }),
        error => Number((error as { statusCode?: number }).statusCode) === 503
      )
    }

    assert.deepEqual(requireAimsNotificationDetailAuthorizationResult({
      authorized: false,
      reasonCode: 'scoped_authorization_required',
      resource: 'work_item',
      id: '42',
      authorizationChallenge: challenge()
    }, descriptor).authorizationChallenge, challenge())
  })

  test('requires an exact, sorted policy decision binding', () => {
    assert.deepEqual(
      requireAimsNotificationAuthorizationDecisionBinding(decision(), challenge()),
      { ...decision(), scopeBasis: [...decision().scopeBasis] }
    )
    for (const invalid of [
      { ...decision(), factsHash: 'c'.repeat(64) },
      { ...decision(), policyBundleHash: '' },
      { ...decision(), policyRevision: -1 },
      { ...decision(), scopeBasis: ['project_code', 'department'] },
      { ...decision(), scopeBasis: ['unknown'] }
    ]) {
      assert.throws(
        () => requireAimsNotificationAuthorizationDecisionBinding(invalid, challenge()),
        error => Number((error as { statusCode?: number }).statusCode) === 503
      )
    }
  })

  test('finalize requires exact runtime evidence including bundle revision and scope basis', () => {
    const binding = requireAimsNotificationAuthorizationDecisionBinding(decision(), challenge())
    const result = requireAimsNotificationDetailFinalizeResult({
      authorized: true,
      reasonCode: 'allowed',
      resource: 'work_item',
      id: '42',
      authorizationEvidence: {
        factsHash,
        objectRevision,
        policyRevision: 17,
        policyBundleHash: 'bundle-hash-17',
        scopeBasis: ['department', 'project_code']
      }
    }, descriptor, challenge(), binding)
    assert.deepEqual(result.authorizationEvidence, {
      factsHash,
      objectRevision,
      policyRevision: 17,
      policyBundleHash: 'bundle-hash-17',
      scopeBasis: ['department', 'project_code']
    })

    assert.throws(() => requireAimsNotificationDetailFinalizeResult({
      ...result,
      authorizationEvidence: { ...result.authorizationEvidence, policyBundleHash: 'changed' }
    }, descriptor, challenge(), binding), error => Number((error as { statusCode?: number }).statusCode) === 503)
  })

  test('parses only server binding fields needed by the two phases', () => {
    assert.deepEqual(parseAimsNotificationFinalizeBinding({
      authorizationChallenge: challenge(),
      decisionBinding: decision()
    }), {
      challenge: challenge(),
      decision: { ...decision(), scopeBasis: [...decision().scopeBasis] }
    })
  })

  test('BFF uses a purpose-bound runtime actor and never forwards current_user query facts', () => {
    const utility = source('server/utils/notificationDetailAuthorization.ts')
    const prepareRoute = source('server/api/v1/service/notification-details/authorize.post.ts')
    const finalizeRoute = source('server/api/v1/service/notification-details/authorize/finalize.post.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.doesNotMatch(utility, /resolveAimsProjectListAdminScopeQuery|fetchUserDepartments|getRequestUid|query:\s*\{\s*current_user/)
    assert.match(utility, /notificationDetailActor:/)
    assert.match(utility, /stage: 'prepare'/)
    assert.match(utility, /descriptor\.resource === 'integration_operation'/)
    assert.match(utility, /notificationId: id,[\s\S]{0,80}descriptor/)
    assert.match(utility, /stage: 'finalize'/)
    assert.match(prepareRoute, /request\.notificationId/)
    assert.match(finalizeRoute, /parseAimsNotificationFinalizeBinding/)
    assert.match(prepareRoute, /aims:notification-details:authorize/)
    assert.match(finalizeRoute, /aims:notification-details:authorize/)
    assert.match(middleware, /notification-details\\\/authorize\(\?:\\\/finalize\)\?/)
    assert.match(middleware, /allowedApps: \['console'\]/)
  })
})
