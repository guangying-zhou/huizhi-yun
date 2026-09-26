import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  enterpriseNotificationSnapshotDetail,
  notificationActionTargetAppCode,
  notificationAuthorizationDescriptor,
  notificationDetailSourceAuthorizationTarget,
  notificationDetailResponse,
  type NotificationDetailFact
} from '../server/utils/notificationDetailContract.ts'
import {
  canonicalizePortalNotificationRequest,
  PortalNotificationPublishError
} from '../server/utils/portalNotificationIdempotency.ts'
import {
  authorizeNotificationDetail,
  normalizeNotificationDetailAuthorizationChallenge,
  notificationDetailScopeBasis,
  notificationAuthorizationResponseMatches,
  NotificationDetailAuthorizationPolicyError,
  type NotificationDetailAuthorizationPolicyVerifier
} from '../server/utils/notificationDetailAuthorizationPolicy.ts'
import { notificationDetailEligibilityTarget } from '../server/utils/subjectEligibilityContract.ts'
import { buildNotificationDetailDepartmentTree } from '../server/utils/notificationDetailDepartmentTree.ts'
import { evaluateWithManagedFreshNotificationDetailPolicy } from '../server/utils/notificationDetailFreshPolicyCore.ts'
import { consoleLifecycleNotificationAuthorizationResult } from '../server/utils/consoleLifecycleNotificationDetailAuthorizationCore.ts'

const FACTS_HASH = 'a'.repeat(64)

function scopedChallenge(overrides: Record<string, unknown> = {}) {
  return {
    authorized: false,
    resource: 'work_item',
    id: '17',
    reasonCode: 'scoped_authorization_required',
    authorizationChallenge: {
      appCode: 'aims',
      resourceCode: 'projects',
      action: 'admin',
      objectRevision: 'work-item:17:project:9:v3',
      factsHash: FACTS_HASH,
      object: {
        projectCode: 'PRJ-9',
        projectId: '9',
        departmentCode: 'dept-child',
        confidentialityLevel: 'L2'
      },
      ...overrides
    }
  }
}

function scopedInput(sourceAppCode = 'aims') {
  return {
    sourceAppCode,
    descriptor: { resource: 'work_item', id: '17' },
    context: { requestId: 'req-1' }
  }
}

function finalized(policyRevision: number | null = 7) {
  return {
    authorized: true,
    resource: 'work_item',
    id: '17',
    authorizationEvidence: {
      factsHash: FACTS_HASH,
      objectRevision: 'work-item:17:project:9:v3',
      policyRevision,
      policyBundleHash: 'bundle-hash-7',
      scopeBasis: ['tenant_global']
    }
  }
}

function fact(overrides: Partial<NotificationDetailFact> = {}): NotificationDetailFact {
  return {
    notificationId: 'notif-1',
    sourceAppCode: 'workflow',
    title: '客户 A 付款审批',
    summary: '金额 1000',
    body: '敏感正文',
    actionUrl: '/workflow/tasks/7',
    bizType: 'payment_request',
    bizId: 'PAY-1',
    metadataJson: {
      workflowInstanceId: 42,
      workflowTaskIds: [9, 7, 9],
      bizKey: 'finance:payment_request:PAY-1',
      actionTargetAppCode: 'workflow',
      internalToken: 'must-not-leak'
    },
    createdAt: '2026-07-10 10:00:00',
    expiresAt: null,
    ...overrides
  }
}

describe('notification detail security contract', () => {
  test('Enterprise Codocs detail exposes only a recipient-bound stored message snapshot', () => {
    const row = fact({
      sourceAppCode: 'enterprise',
      title: '文档共享通知',
      body: '文档已共享给您，请查阅。',
      actionUrl: '/codocs/documents/deleted-document',
      bizType: 'document_share',
      bizId: 'share-7',
      metadataJson: {
        notificationKind: 'business_event',
        moduleAppCode: 'codocs',
        documentUuid: 'deleted-document',
        internalToken: 'must-not-leak'
      }
    })
    const detail = enterpriseNotificationSnapshotDetail(row)
    assert.equal(detail?.detailMode, 'notification_snapshot')
    assert.equal(detail?.title, row.title)
    assert.equal(detail?.body, row.body)
    assert.equal(detail?.actionUrl, null)
    assert.equal(detail?.bizType, null)
    assert.equal(detail?.bizId, null)
    assert.equal(JSON.stringify(detail).includes('deleted-document'), false)
    assert.equal(JSON.stringify(detail).includes('must-not-leak'), false)
    for (const metadataJson of [
      { notificationKind: 'business_event', moduleAppCode: 'unknown' },
      { notificationKind: 'other', moduleAppCode: 'codocs' },
      { notificationKind: 'business_event', moduleAppCode: 'codocs' }
    ]) {
      assert.equal(enterpriseNotificationSnapshotDetail(fact({
        ...row,
        bizType: metadataJson.moduleAppCode === 'codocs' && metadataJson.notificationKind === 'business_event' ? 'unknown' : row.bizType,
        metadataJson
      })), null)
    }
  })

  async function assertAuthorizationError(
    verifier: NotificationDetailAuthorizationPolicyVerifier | null,
    expected: 'notification_detail_restricted' | 'notification_detail_unavailable'
  ) {
    await assert.rejects(
      authorizeNotificationDetail({
        sourceAppCode: 'aims',
        descriptor: { resource: 'work_item', id: '17' },
        context: null
      }, verifier),
      (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
        && error.code === expected
    )
  }

  test('Workflow authorization identity is stable, deduplicated, and sorted', () => {
    assert.deepEqual(notificationAuthorizationDescriptor(fact()), {
      resource: 'workflow_task',
      id: 'instance:42:tasks:7,9'
    })
    assert.deepEqual(notificationAuthorizationDescriptor(fact({
      metadataJson: { workflowInstanceId: '0042', workflowTaskIds: [] }
    })), {
      resource: 'workflow_instance',
      id: '42'
    })
  })

  test('Aims authorization identity normalizes work item id', () => {
    assert.deepEqual(notificationAuthorizationDescriptor(fact({
      sourceAppCode: 'aims',
      bizType: 'work_item',
      bizId: '00017',
      metadataJson: { workItemId: '00017' }
    })), { resource: 'work_item', id: '17' })
  })

  test('Aims feedback detail uses an exact recipient-scoped WebDev issue tuple', () => {
    const feedback = (bizId: string, metadataJson: Record<string, unknown> = {}) => fact({
      sourceAppCode: 'aims',
      bizType: 'webdev_issue',
      bizId,
      metadataJson
    })
    assert.deepEqual(notificationAuthorizationDescriptor(feedback('0123456789abcdef', {
      kind: 'bug',
      displayNo: '10'
    })), { resource: 'webdev_issue', id: '0123456789abcdef' })
    assert.equal(notificationAuthorizationDescriptor(feedback('')), null)
    assert.equal(notificationAuthorizationDescriptor(feedback('issue/10')), null)
    assert.deepEqual(notificationDetailEligibilityTarget('aims', 'webdev_issue'), {
      targetAppCode: 'aims',
      resourceCode: 'work_items',
      action: 'view'
    })
  })

  test('Aims and Altoc dead letters use the exact safe integration operation descriptor', () => {
    for (const sourceAppCode of ['aims', 'altoc']) {
      assert.deepEqual(notificationAuthorizationDescriptor(fact({
        sourceAppCode,
        bizType: 'integration_operation',
        bizId: '90b90bf3-5899-4aed-98c8-23dd1897f463',
        metadataJson: {
          authorizationDescriptor: {
            resource: 'integration_operation',
            id: '90b90bf3-5899-4aed-98c8-23dd1897f463'
          }
        }
      })), {
        resource: 'integration_operation',
        id: '90b90bf3-5899-4aed-98c8-23dd1897f463'
      })
    }
  })

  test('Assets and People are supported direct sources with exact audiences and capabilities', () => {
    assert.deepEqual(notificationDetailSourceAuthorizationTarget('ASSETS'), {
      audience: 'assets',
      scope: 'assets:notification-details:authorize'
    })
    assert.deepEqual(notificationDetailSourceAuthorizationTarget('PEOPLE'), {
      audience: 'people',
      scope: 'people:notification-details:authorize'
    })
    assert.deepEqual(notificationDetailSourceAuthorizationTarget('FINANCE'), {
      audience: 'finance',
      scope: 'finance:notification-details:authorize'
    })
    assert.deepEqual(notificationDetailSourceAuthorizationTarget('ALTOC'), {
      audience: 'altoc',
      scope: 'altoc:notification-details:authorize'
    })
    assert.equal(notificationDetailSourceAuthorizationTarget('unknown-app'), null)
    assert.deepEqual(notificationAuthorizationDescriptor(fact({
      sourceAppCode: 'assets',
      bizType: 'asset_item',
      bizId: 'ASSET-17',
      metadataJson: {
        authorizationDescriptor: { resource: 'asset_item', id: 'ASSET-17' }
      }
    })), { resource: 'asset_item', id: 'ASSET-17' })
    assert.deepEqual(notificationAuthorizationDescriptor(fact({
      sourceAppCode: 'assets',
      bizType: 'customer_delivery_asset',
      bizId: 'CDA-17',
      metadataJson: {
        authorizationDescriptor: { resource: 'customer_delivery_asset', id: 'CDA-17' }
      }
    })), { resource: 'customer_delivery_asset', id: 'CDA-17' })
    assert.deepEqual(notificationAuthorizationDescriptor(fact({
      sourceAppCode: 'assets',
      bizType: 'offboarding_recovery_case',
      bizId: 'ORC-17',
      metadataJson: {
        authorizationDescriptor: { resource: 'offboarding_recovery_case', id: 'ORC-17' }
      }
    })), { resource: 'offboarding_recovery_case', id: 'ORC-17' })
  })

  test('Finance descriptor is exact and mirrored by bizType/bizId', () => {
    const financeFact = (resource: string, id: string, descriptor: Record<string, unknown>) => fact({
      sourceAppCode: 'finance',
      bizType: resource,
      bizId: id,
      metadataJson: { authorizationDescriptor: descriptor }
    })
    assert.deepEqual(notificationAuthorizationDescriptor(financeFact('invoice_request', 'IR-42', { resource: 'invoice_request', id: 'IR-42' })), { resource: 'invoice_request', id: 'IR-42' })
    assert.deepEqual(notificationAuthorizationDescriptor(financeFact('finance_receipt', 'RCV-42', { resource: 'finance_receipt', id: 'RCV-42' })), { resource: 'finance_receipt', id: 'RCV-42' })
    assert.deepEqual(notificationAuthorizationDescriptor(financeFact('integration_operation', '90b90bf3-5899-4aed-98c8-23dd1897f463', { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' })), { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' })
    assert.equal(notificationAuthorizationDescriptor(financeFact('invoice_request', 'IR-42', { resource: 'invoice_request', id: 'IR-41' })), null)
    assert.equal(notificationAuthorizationDescriptor(financeFact('invoice_request', 'IR-42', { resource: 'invoice_request', id: 'IR-42', owner: 'forged' })), null)
  })

  test('Altoc descriptor accepts only one mirrored receivable plan tuple', () => {
    const altocFact = (metadataJson: Record<string, unknown>, overrides: Partial<NotificationDetailFact> = {}) => fact({
      sourceAppCode: 'altoc', bizType: 'receivable_plan', bizId: 'RP-42', metadataJson, ...overrides
    })
    assert.deepEqual(notificationAuthorizationDescriptor(altocFact({ authorizationDescriptor: { resource: 'receivable_plan', id: 'RP-42' } })), { resource: 'receivable_plan', id: 'RP-42' })
    assert.equal(notificationAuthorizationDescriptor(altocFact({ authorizationDescriptor: { resource: 'receivable_overdue_scan', id: 'RP-42' } })), null)
    assert.equal(notificationAuthorizationDescriptor(altocFact({ authorizationDescriptor: { resource: 'receivable_plan', id: 'RP-41' } })), null)
    assert.equal(notificationAuthorizationDescriptor(altocFact({ authorizationDescriptor: { resource: 'receivable_plan', id: 'RP-42', owner: 'forged' } })), null)
  })

  test('Console detail descriptors are exact, mirrored, and limited to registered resources', () => {
    const consoleFact = (metadataJson: Record<string, unknown>, overrides: Partial<NotificationDetailFact> = {}) => fact({
      sourceAppCode: 'console',
      bizType: 'people_lifecycle_authorization',
      bizId: 'employee-42',
      metadataJson,
      ...overrides
    })
    assert.equal(notificationDetailSourceAuthorizationTarget('console'), null)
    assert.deepEqual(notificationAuthorizationDescriptor(consoleFact({
      authorizationDescriptor: { resource: 'people_lifecycle_authorization', id: 'employee-42' }
    })), { resource: 'people_lifecycle_authorization', id: 'employee-42' })
    assert.equal(notificationAuthorizationDescriptor(consoleFact({
      authorizationDescriptor: { resource: 'people_lifecycle_authorization', id: 'employee-41' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(consoleFact({
      authorizationDescriptor: { resource: 'people_lifecycle_authorization', id: 'employee-42', phase: 'forged' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(consoleFact({
      authorization: { resource: 'people_lifecycle_authorization', id: 'employee-42' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(consoleFact({
      authorizationDescriptor: { resource: 'integration_operation', id: 'employee-42' }
    }, { bizType: 'integration_operation' })), null)

    const runtimeFact = (metadataJson: Record<string, unknown>, overrides: Partial<NotificationDetailFact> = {}) => fact({
      sourceAppCode: 'console',
      bizType: 'notification_runtime',
      bizId: 'wecom.default',
      metadataJson,
      ...overrides
    })
    assert.deepEqual(notificationAuthorizationDescriptor(runtimeFact({
      authorizationDescriptor: { resource: 'notification_runtime', id: 'wecom.default' }
    })), { resource: 'notification_runtime', id: 'wecom.default' })
    assert.deepEqual(notificationAuthorizationDescriptor(runtimeFact({})), {
      resource: 'notification_runtime',
      id: 'wecom.default'
    })
    assert.equal(notificationAuthorizationDescriptor(runtimeFact({
      authorizationDescriptor: { resource: 'notification_runtime', id: 'wecom.other' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(runtimeFact({}, { bizType: 'unregistered_console_resource' })), null)
  })

  test('Console lifecycle detail requires both current permissions and fails closed after either is revoked', () => {
    const descriptor = { resource: 'people_lifecycle_authorization', id: 'employee-42' }
    const authorize = (authorizationLifecycleView: boolean, auditLogsView: boolean) => (
      consoleLifecycleNotificationAuthorizationResult('security-operator', descriptor, {
        authorizationLifecycleView,
        auditLogsView
      })
    )
    assert.deepEqual(authorize(true, true), {
      authorized: true,
      reasonCode: 'allowed',
      ...descriptor
    })
    assert.deepEqual(authorize(false, true), {
      authorized: false,
      reasonCode: 'not_authorized',
      ...descriptor
    })
    assert.deepEqual(authorize(true, false), {
      authorized: false,
      reasonCode: 'not_authorized',
      ...descriptor
    })
    assert.equal(consoleLifecycleNotificationAuthorizationResult('security-operator', {
      ...descriptor,
      bizKey: 'forged'
    }, { authorizationLifecycleView: true, auditLogsView: true }).authorized, false)
  })

  test('Console notification-runtime detail requires current system settings view', () => {
    const descriptor = { resource: 'notification_runtime', id: 'wecom.default' }
    assert.equal(consoleLifecycleNotificationAuthorizationResult('security-operator', descriptor, {
      authorizationLifecycleView: false,
      auditLogsView: false,
      systemSettingsView: true
    }).authorized, true)
    assert.equal(consoleLifecycleNotificationAuthorizationResult('security-operator', descriptor, {
      authorizationLifecycleView: true,
      auditLogsView: true,
      systemSettingsView: false
    }).authorized, false)
  })

  test('Assets descriptor rejects generic fallback, resource drift, duplicate-fact drift, and extra fields', () => {
    const assetsFact = (metadataJson: Record<string, unknown>, overrides: Partial<NotificationDetailFact> = {}) => fact({
      sourceAppCode: 'assets',
      bizType: 'asset_item',
      bizId: 'ASSET-17',
      metadataJson,
      ...overrides
    })
    assert.equal(notificationAuthorizationDescriptor(assetsFact({
      authorization: { resource: 'asset_item', id: 'ASSET-17' }
    })), null)

    assert.equal(notificationAuthorizationDescriptor(assetsFact({
      authorizationDescriptor: { resource: 'asset', id: 'ASSET-17' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(assetsFact({
      authorizationDescriptor: { resource: 'asset_item', id: 'ASSET-17' }
    }, { bizId: 'ASSET-18' })), null)
    assert.equal(notificationAuthorizationDescriptor(assetsFact({
      authorizationDescriptor: { resource: 'asset_item', id: 'ASSET-17', subjectUid: 'forged' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(assetsFact({
      authorizationDescriptor: { resource: 'offboarding_recovery_case', id: 'ORC-17' }
    }, { bizType: 'offboarding_recovery_case', bizId: 'ORC-18' })), null)
    assert.deepEqual(notificationAuthorizationDescriptor(assetsFact({
      authorizationDescriptor: { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' }
    }, { bizType: 'integration_operation', bizId: '90b90bf3-5899-4aed-98c8-23dd1897f463' })), { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' })
  })

  test('People descriptor is exact, task-scoped, and mirrored by bizType/bizId', () => {
    const peopleFact = (metadataJson: Record<string, unknown>, overrides: Partial<NotificationDetailFact> = {}) => fact({
      sourceAppCode: 'people',
      bizType: 'offboarding_task',
      bizId: 'OBT-42',
      metadataJson,
      ...overrides
    })
    assert.deepEqual(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'offboarding_task', id: 'OBT-42' }
    })), { resource: 'offboarding_task', id: 'OBT-42' })
    assert.equal(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'offboarding_task', id: 'OBT-42', caseCode: 'OBC-7' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'offboarding_task', id: 'OBT-41' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'employee', id: 'OBT-42' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(peopleFact({
      authorization: { resource: 'offboarding_task', id: 'OBT-42' }
    })), null)
    assert.equal(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'offboarding_task', id: 'OBT-42' }
    }, { bizType: 'assignment' })), null)
    assert.deepEqual(notificationAuthorizationDescriptor(peopleFact({
      authorizationDescriptor: { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' }
    }, { bizType: 'integration_operation', bizId: '90b90bf3-5899-4aed-98c8-23dd1897f463' })), { resource: 'integration_operation', id: '90b90bf3-5899-4aed-98c8-23dd1897f463' })
  })

  test('Assets accepts only a direct exact tuple and never enters the Aims scoped challenge', async () => {
    const input = {
      sourceAppCode: 'assets',
      descriptor: { resource: 'asset_item', id: 'ASSET-17' },
      context: null
    }
    await authorizeNotificationDetail(input, async () => ({
      authorized: true,
      resource: 'asset_item',
      id: 'ASSET-17'
    }))

    let scopedCalls = 0
    await assert.rejects(authorizeNotificationDetail(
      input,
      async () => ({
        authorized: false,
        resource: 'asset_item',
        id: 'ASSET-17',
        reasonCode: 'scoped_authorization_required',
        authorizationChallenge: scopedChallenge().authorizationChallenge
      }),
      'user-17',
      async () => {
        scopedCalls += 1
        return { allowed: true, policyRevision: 7, policyBundleHash: 'bundle-hash-7' }
      },
      async () => assert.fail('Assets must not finalize a scoped challenge')
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_unavailable')
    assert.equal(scopedCalls, 0)
  })

  test('People accepts only a direct exact tuple and never enters the Aims scoped challenge', async () => {
    const input = {
      sourceAppCode: 'people',
      descriptor: { resource: 'offboarding_task', id: 'OBT-42' },
      context: null
    }
    await authorizeNotificationDetail(input, async () => ({
      authorized: true,
      resource: 'offboarding_task',
      id: 'OBT-42'
    }))

    let scopedCalls = 0
    await assert.rejects(authorizeNotificationDetail(
      input,
      async () => ({
        authorized: false,
        resource: 'offboarding_task',
        id: 'OBT-42',
        reasonCode: 'scoped_authorization_required',
        authorizationChallenge: scopedChallenge().authorizationChallenge
      }),
      'user-42',
      async () => {
        scopedCalls += 1
        return { allowed: true, policyRevision: 7, policyBundleHash: 'bundle-hash-7' }
      },
      async () => assert.fail('People must not finalize a scoped challenge')
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_unavailable')
    assert.equal(scopedCalls, 0)
  })

  test('authorization response must explicitly allow and exactly echo identity', () => {
    const descriptor = { resource: 'work_item', id: '17' }
    assert.equal(notificationAuthorizationResponseMatches(descriptor, {
      authorized: true, resource: 'work_item', id: '17'
    }), true)
    assert.equal(notificationAuthorizationResponseMatches(descriptor, {
      authorized: true, resource: 'work_item', id: '18'
    }), false)
    assert.equal(notificationAuthorizationResponseMatches(descriptor, {
      authorized: false, resource: 'work_item', id: '17'
    }), false)
  })

  test('injected verifier allows only an exact positive source decision', async () => {
    await authorizeNotificationDetail({
      sourceAppCode: 'aims',
      descriptor: { resource: 'work_item', id: '17' },
      context: null
    }, async () => ({ authorized: true, resource: 'work_item', id: '17' }))
    await assertAuthorizationError(
      async () => ({ authorized: false, resource: 'work_item', id: '17' }),
      'notification_detail_restricted'
    )
    await assertAuthorizationError(
      async () => ({ authorized: true, resource: 'work_item', id: '18' }),
      'notification_detail_restricted'
    )
  })

  test('Aims subject-scoped challenge allows only after fresh local decision and exact finalize evidence', async () => {
    let finalizedCount = 0
    await authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async (input) => {
        assert.equal(input.subjectUid, 'user-17')
        assert.equal(input.appCode, 'aims')
        assert.equal(input.resourceCode, 'projects')
        assert.equal(input.action, 'admin')
        assert.equal(input.object.actorUid, 'user-17')
        assert.deepEqual(input.object.projectMemberUids, [])
        assert.deepEqual(input.object.matchedRelations, [])
        assert.equal(input.object.departmentCode, 'dept-child')
        return {
          allowed: true,
          policyRevision: 7,
          policyBundleHash: 'bundle-hash-7',
          matchedScopes: [{ dimension: 'tenant', predicate: 'global' }]
        }
      },
      async (_input, challenge, binding) => {
        finalizedCount += 1
        assert.equal(challenge.factsHash, FACTS_HASH)
        assert.deepEqual(binding, {
          allowed: true,
          appCode: 'aims',
          resourceCode: 'projects',
          action: 'admin',
          factsHash: FACTS_HASH,
          policyRevision: 7,
          policyBundleHash: 'bundle-hash-7',
          scopeBasis: ['tenant_global']
        })
        return finalized()
      }
    )
    assert.equal(finalizedCount, 1)
  })

  test('scope deny never reaches finalize', async () => {
    let finalizedCount = 0
    await assert.rejects(authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async () => ({ allowed: false, policyRevision: 7, policyBundleHash: 'bundle-hash-7', matchedScopes: [] }),
      async () => {
        finalizedCount += 1
        return finalized()
      }
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_restricted')
    assert.equal(finalizedCount, 0)
  })

  test('challenge tuple drift, source mismatch, and object field injection are unavailable', async () => {
    const run = async (sourceAppCode: string, challenge: ReturnType<typeof scopedChallenge>) => {
      await assert.rejects(authorizeNotificationDetail(
        scopedInput(sourceAppCode),
        async () => challenge,
        'user-17',
        async () => ({ allowed: true, policyRevision: 7, policyBundleHash: 'bundle-hash-7', matchedScopes: [] }),
        async () => finalized()
      ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
        && error.code === 'notification_detail_unavailable')
    }

    for (const drift of [
      { appCode: 'workflow' },
      { resourceCode: 'work-items' },
      { action: 'view' }
    ]) await run('aims', scopedChallenge(drift))
    await run('workflow', scopedChallenge())
    await run('aims', scopedChallenge({
      object: {
        projectCode: 'PRJ-9',
        confidentialityLevel: 'L2',
        actorUid: 'attacker'
      }
    }))
  })

  test('policy unavailability maps to 503 semantics and never finalizes', async () => {
    await assert.rejects(authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async () => { throw new Error('bundle unavailable') },
      async () => assert.fail('finalize must not run')
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_unavailable')
  })

  test('L3 denies both exact department and ancestor-tree grants before finalize', async () => {
    const challenge = scopedChallenge({
      object: {
        projectCode: 'PRJ-9',
        departmentCode: 'dept-child',
        confidentialityLevel: 'L3'
      }
    })
    for (const predicate of ['self', 'tree']) {
      await assert.rejects(authorizeNotificationDetail(
        scopedInput(),
        async () => challenge,
        'user-17',
        async () => ({
          allowed: true,
          policyRevision: 7,
          policyBundleHash: 'bundle-hash-7',
          matchedScopes: [{ dimension: 'department', predicate, value: predicate === 'tree' ? 'dept-root' : 'dept-child' }]
        }),
        async () => assert.fail('L3 department decision must not finalize')
      ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
        && error.code === 'notification_detail_restricted')
    }
  })

  test('challenge normalization rejects client-like relation facts and never accepts an empty member list', () => {
    const normalized = normalizeNotificationDetailAuthorizationChallenge(
      scopedInput(),
      scopedChallenge(),
      'user-17'
    )
    assert.deepEqual(normalized?.projectMemberUids, [])
    assert.deepEqual(normalized?.matchedRelations, [])
    assert.equal(normalizeNotificationDetailAuthorizationChallenge(
      scopedInput(),
      scopedChallenge({ object: { projectCode: 'PRJ-9', confidentialityLevel: 'L2', matchedRelations: [] } }),
      'user-17'
    ), null)
  })

  test('notification project-code evidence requires the explicit code predicate', () => {
    assert.deepEqual(notificationDetailScopeBasis([
      { dimension: 'project', predicate: 'code', value: 'PRJ-9' }
    ]), ['project_code'])
    assert.deepEqual(notificationDetailScopeBasis([
      { dimension: 'project', predicate: 'member', value: 'PRJ-9' }
    ]), ['project_member'])
    assert.deepEqual(notificationDetailScopeBasis([
      { dimension: 'project', predicate: 'owner', value: 'PRJ-9' }
    ]), ['project_owner'])
    assert.equal(notificationDetailScopeBasis([
      { dimension: 'project', predicate: 'unknown', value: 'PRJ-9' }
    ]), null)
  })

  test('finalize must echo exact facts, revision, and policy revision evidence', async () => {
    await assert.rejects(authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async () => ({ allowed: true, policyRevision: 7, policyBundleHash: 'bundle-hash-7', matchedScopes: [] }),
      async () => finalized(8)
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_restricted')
  })

  test('empty decision bundle hash and mismatched finalize bundle hash fail closed', async () => {
    await assert.rejects(authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async () => ({ allowed: true, policyRevision: null, policyBundleHash: '', matchedScopes: [] }),
      async () => assert.fail('empty policy hash must not finalize')
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_unavailable')

    await assert.rejects(authorizeNotificationDetail(
      scopedInput(),
      async () => scopedChallenge(),
      'user-17',
      async () => ({ allowed: true, policyRevision: null, policyBundleHash: 'bundle-hash-current', matchedScopes: [] }),
      async () => ({
        ...finalized(null),
        authorizationEvidence: {
          ...finalized(null).authorizationEvidence,
          policyBundleHash: 'bundle-hash-stale',
          scopeBasis: ['unscoped']
        }
      })
    ), (error: unknown) => error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_restricted')
  })

  test('department scope context includes the exact department and trusted ancestors', async () => {
    const rows = new Map([
      ['dept-child', { deptCode: 'dept-child', parentDeptCode: 'dept-parent' }],
      ['dept-parent', { deptCode: 'dept-parent', parentDeptCode: 'dept-root' }],
      ['dept-root', { deptCode: 'dept-root', parentDeptCode: null }]
    ])
    assert.deepEqual(await buildNotificationDetailDepartmentTree(
      'dept-child',
      async code => rows.get(code) || null
    ), ['dept-child', 'dept-parent', 'dept-root'])
    await assert.rejects(buildNotificationDetailDepartmentTree(
      'unknown',
      async code => rows.get(code) || null
    ), /directory_department_not_found/)
  })

  test('managed detail authorization evaluates only after a fresh bound bundle replaces stale allow', async () => {
    let effectiveDecision = 'stale-allow'
    const decision = await evaluateWithManagedFreshNotificationDetailPolicy(
      true,
      { tenantId: 'TENANT-A', deploymentId: 'DEPLOYMENT-A' },
      async () => effectiveDecision,
      async () => {
        effectiveDecision = 'fresh-deny'
        return {
          ok: true,
          bundle: { tenantCode: 'TENANT-A', deploymentCode: 'DEPLOYMENT-A' }
        }
      }
    )
    assert.equal(decision, 'fresh-deny')
  })

  test('managed detail authorization accepts the canonical Console bundle for a business-app request', async () => {
    const decision = await evaluateWithManagedFreshNotificationDetailPolicy(
      true,
      { tenantId: 'TENANT-A', deploymentId: 'TENANT-A-assets' },
      async () => 'fresh-console-policy',
      async () => ({
        ok: true,
        bundle: { tenantCode: 'TENANT-A', deploymentCode: 'TENANT-A-console' }
      })
    )
    assert.equal(decision, 'fresh-console-policy')
  })

  test('managed refresh failure never falls back to a stale allow decision', async () => {
    let evaluated = false
    await assert.rejects(evaluateWithManagedFreshNotificationDetailPolicy(
      true,
      { tenantId: 'TENANT-A', deploymentId: 'DEPLOYMENT-A' },
      async () => {
        evaluated = true
        return 'stale-allow'
      },
      async () => ({ ok: false, bundle: null })
    ), /notification_detail_policy_refresh_unavailable/)
    assert.equal(evaluated, false)
  })

  test('standalone detail authorization does not make an implicit control-plane refresh', async () => {
    let refreshCalls = 0
    assert.equal(await evaluateWithManagedFreshNotificationDetailPolicy(
      false,
      { tenantId: 'TENANT-A', deploymentId: 'DEPLOYMENT-A' },
      async () => 'current-verified-cache',
      async () => {
        refreshCalls += 1
        return { ok: false, bundle: null }
      }
    ), 'current-verified-cache')
    assert.equal(refreshCalls, 0)
  })

  test('source permission statuses are restricted but contract and availability failures are unavailable', async () => {
    for (const statusCode of [401, 403, 404]) {
      await assertAuthorizationError(
        async () => {
          throw { statusCode }
        },
        'notification_detail_restricted'
      )
    }
    for (const statusCode of [400, 429, 500, 503]) {
      await assertAuthorizationError(
        async () => {
          throw { statusCode }
        },
        'notification_detail_unavailable'
      )
    }
    await assertAuthorizationError(async () => {
      throw new Error('network')
    }, 'notification_detail_unavailable')
    await assertAuthorizationError(null, 'notification_detail_unavailable')
  })

  test('detail response exposes no raw metadata, bizKey, creator, or idempotency identity', () => {
    const detail = notificationDetailResponse(fact())
    assert.equal(notificationActionTargetAppCode(fact()), 'workflow')
    assert.deepEqual(Object.keys(detail).sort(), [
      'actionTargetAppCode', 'actionUrl', 'bizId', 'bizType', 'body', 'createdAt',
      'expiresAt', 'notificationId', 'sourceAppCode', 'summary', 'title'
    ])
    assert.doesNotMatch(JSON.stringify(detail), /bizKey|internalToken|idempotency|createdBy/)
  })

  test('publish rejects script, data, protocol-relative, credential, control, and backslash URLs', () => {
    for (const actionUrl of [
      'javascript:alert(1)',
      'data:text/html,test',
      '//evil.example/path',
      'https://user:pass@example.test/path',
      '/safe\r\nX-Test: injected',
      '/\\evil.example/path'
    ]) {
      assert.throws(() => canonicalizePortalNotificationRequest({
        sourceAppCode: 'aims', title: 'safe', actionUrl,
        idempotencyKey: `key-${actionUrl}`, recipients: ['u1']
      }, { appCode: 'aims' }), (error: unknown) => (
        error instanceof PortalNotificationPublishError
        && error.code === 'invalid_action_url'
      ))
    }
    assert.equal(canonicalizePortalNotificationRequest({
      sourceAppCode: 'aims', title: 'safe', actionUrl: '/aims/work-items/17',
      idempotencyKey: 'safe-relative', recipients: ['u1']
    }, { appCode: 'aims' }).actionUrl, '/aims/work-items/17')
    assert.equal(canonicalizePortalNotificationRequest({
      sourceAppCode: 'aims', title: 'safe', actionUrl: 'https://aims.example.test/items/17',
      idempotencyKey: 'safe-absolute', recipients: ['u1']
    }, { appCode: 'aims' }).actionUrl, 'https://aims.example.test/items/17')
  })

  test('publish rejects a missing app identity and forged source before persistence', () => {
    assert.throws(() => canonicalizePortalNotificationRequest({
      sourceAppCode: 'aims',
      title: 'forged',
      idempotencyKey: 'forged-source',
      recipients: ['u1']
    }, { actorId: 'legacy-client', appCode: null }), (error: unknown) => (
      error instanceof PortalNotificationPublishError
      && error.code === 'source_app_identity_required'
      && error.statusCode === 403
    ))
    assert.throws(() => canonicalizePortalNotificationRequest({
      sourceAppCode: 'workflow',
      title: 'forged',
      idempotencyKey: 'forged-source-2',
      recipients: ['u1']
    }, { actorId: 'aims-client', appCode: 'aims' }), (error: unknown) => (
      error instanceof PortalNotificationPublishError
      && error.code === 'source_app_mismatch'
      && error.statusCode === 403
    ))
  })

  test('list query and envelope never select or return source-defined sensitive fields', () => {
    const consoleSource = readFileSync(new URL('../server/utils/notifications.ts', import.meta.url), 'utf8')
    const runtimeSource = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications_write.go', import.meta.url), 'utf8')
    const selectStart = runtimeSource.indexOf('SELECT p.id,p.current_notification_id')
    const selectEnd = runtimeSource.indexOf('FROM portal_actionable_projections p', selectStart)
    const select = runtimeSource.slice(selectStart, selectEnd)
    for (const field of ['n.title', 'n.summary', 'n.body', 'n.action_url', 'n.biz_type', 'n.biz_id', 'n.metadata_json', 'n.idempotency_key', 'n.created_by']) {
      assert.doesNotMatch(select, new RegExp(field.replace('.', '\\.')))
    }
    assert.match(runtimeSource, /"displayLabel": notificationDisplayLabel\(category\)/)
    assert.doesNotMatch(consoleSource, /server\/utils\/db|queryRow|execute|withTransaction/)
  })

  test('detail route authenticates user before reading notification id', () => {
    const route = readFileSync(new URL('../server/api/v1/console/notifications/[notificationId]/detail.get.ts', import.meta.url), 'utf8')
    assert.ok(route.indexOf('requireNotificationUserUid(event)') < route.indexOf('getRouterParam(event, \'notificationId\')'))
    assert.doesNotMatch(route, /readBody|query\.uid|body\?\.uid/)

    const implementation = readFileSync(new URL('../server/utils/notificationDetails.ts', import.meta.url), 'utf8')
    assert.match(implementation, /notificationDetailSourceAuthorizationTarget\(source\)/)
    assert.match(implementation, /source === 'console'[\s\S]{0,240}authorizeConsoleLifecycleNotificationDetail/)
    assert.match(implementation, /audience: target\.audience/)
    assert.match(implementation, /scope: target\.scope/)
    assert.match(implementation, /resolveServiceAppBaseUrl\(input\.event, input\.sourceAppCode, \{ directTarget: true \}\)/)
    assert.match(implementation, /trustedServiceRequestHeaders\(input\.event, input\.sourceAppCode\)/)
    assert.match(implementation, /source === 'aims'[\s\S]{0,160}input\.request\.descriptor\.resource === 'webdev_issue'/)
    assert.match(implementation, /resetNotificationDetailAuthorizationVerifiersForTest/)
    assert.match(implementation, /AUTHORIZATION_FINALIZE_PATH/)
    assert.match(implementation, /notificationId: row\.notificationId/)
    assert.match(implementation, /authorizationMode: 'merged'/)
    assert.match(implementation, /ignoreSimulationSession: true/)
    assert.match(implementation, /bypassSnapshotCache: true/)
    assert.match(implementation, /loadNotificationDetailDepartmentTree/)
    assert.doesNotMatch(implementation, /Authorization: `Bearer \$\{.*user|x-hzy-actor-uid|x-user-uid/)

    const localAuthorization = readFileSync(new URL('../server/utils/consoleLifecycleNotificationDetailAuthorization.ts', import.meta.url), 'utf8')
    assert.match(localAuthorization, /authorizationMode: 'merged'/)
    assert.match(localAuthorization, /ignoreSimulationSession: true/)
    assert.match(localAuthorization, /bypassSnapshotCache: true/)
    assert.match(localAuthorization, /'authorization_lifecycle', 'view'/)
    assert.match(localAuthorization, /'audit_logs', 'view'/)
    assert.doesNotMatch(localAuthorization, /requestWithServiceAccessToken|Authorization:\s*Bearer/)
    assert.match(implementation, /getConsoleUserNotificationDetailFact\(event, notificationId\)/)
    assert.doesNotMatch(implementation, /server\/utils\/db|queryRow/)
    const runtimeNotifications = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications.go', import.meta.url), 'utf8')
    assert.match(runtimeNotifications, /WHERE r\.uid=\? AND r\.notification_id=\?/)

    const policy = readFileSync(new URL('../server/utils/policyAuthorization.ts', import.meta.url), 'utf8')
    assert.match(policy, /const canUseSnapshotCache = !simulation && !options\.bypassSnapshotCache/)
  })
})
