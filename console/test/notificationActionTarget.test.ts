import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { H3Event } from 'h3'
import {
  bindPendingNotificationActionTarget,
  bindWorkflowNotificationActionTarget,
  resolveRegisteredNotificationActionTarget
} from '../server/utils/notificationActionTarget.ts'
import { canonicalizePortalNotificationRequest } from '../server/utils/portalNotificationIdempotency.ts'

const event = {} as H3Event
const applications = [
  { appCode: 'finance', homeUrl: 'https://tenant.example.test/finance/', status: 'active' },
  { appCode: 'workflow', homeUrl: 'https://tenant.example.test/workflow/', status: 'active' }
]
const dependencies = {
  loadApplications: async () => applications,
  requestOrigin: () => 'https://tenant.example.test'
}

describe('Workflow notification action target binding', () => {
  test('canonicalizes an app-relative action before persistence', async () => {
    const body = await bindWorkflowNotificationActionTarget(event, {
      actionUrl: '/payments/PAY-1',
      metadata: { targetAppCode: 'finance', actionableKey: 'workflow:tasks:1' }
    }, 'workflow', dependencies)
    assert.equal(body.actionUrl, 'https://tenant.example.test/finance/payments/PAY-1')
    assert.deepEqual(body.metadata, {
      targetAppCode: 'finance',
      actionableKey: 'workflow:tasks:1',
      actionTargetAppCode: 'finance',
      actionTargetCatalogBinding: 'catalog-v1'
    })
  })

  test('rejects an absolute URL outside the registered target application', async () => {
    await assert.rejects(() => bindWorkflowNotificationActionTarget(event, {
      actionUrl: 'https://evil.example.test/finance/payments/PAY-1',
      metadata: { targetAppCode: 'finance' }
    }, 'workflow', dependencies), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400)
      assert.equal((error as { statusMessage?: string }).statusMessage, 'invalid_action_target')
      return true
    })
  })

  test('leaves non-Workflow publishers unchanged', async () => {
    const body = { actionUrl: '/payments/PAY-1', metadata: { targetAppCode: 'finance' } }
    let catalogLoads = 0
    assert.equal(await bindWorkflowNotificationActionTarget(event, body, 'finance', {
      ...dependencies,
      loadApplications: async () => {
        catalogLoads += 1
        return applications
      }
    }), body)
    assert.equal(catalogLoads, 0)
  })

  test('binds every explicit pending actionable before canonical hashing', async () => {
    const base = {
      actionUrl: '/work-items/17',
      metadata: {
        actionableState: 'pending',
        actionableKey: 'aims:work-item:17:v1',
        objectVersion: 'v1',
        targetAppCode: 'aims'
      }
    }
    const bound = await bindPendingNotificationActionTarget(event, base, 'aims', {
      loadApplications: async () => [{ appCode: 'aims', homeUrl: 'https://tenant.example.test/aims/', status: 'active' }],
      requestOrigin: () => 'https://tenant.example.test'
    })
    assert.equal(bound.actionUrl, 'https://tenant.example.test/aims/work-items/17')
    assert.deepEqual(bound.metadata, {
      ...base.metadata,
      targetAppCode: 'aims',
      actionTargetAppCode: 'aims',
      actionTargetCatalogBinding: 'catalog-v1'
    })
    const canonical = canonicalizePortalNotificationRequest({
      ...bound,
      sourceAppCode: 'aims', title: 'Work item', idempotencyKey: 'aims:work-item:17:v1', recipients: ['u1'],
      bizType: 'work_item', bizId: '17'
    }, { appCode: 'aims' })
    assert.equal(canonical.actionable?.targetAppCode, 'aims')
    assert.throws(() => canonicalizePortalNotificationRequest({
      ...base,
      sourceAppCode: 'aims', title: 'Unbound', idempotencyKey: 'aims:work-item:17:unbound', recipients: ['u1'],
      bizType: 'work_item', bizId: '17'
    }, { appCode: 'aims' }), /catalog-bound action target/)
  })

  test('rejects conflicting target aliases and does not bind non-Workflow terminal lifecycle notifications', async () => {
    await assert.rejects(() => bindPendingNotificationActionTarget(event, {
      actionUrl: '/work-items/17',
      metadata: { actionableState: 'pending', targetAppCode: 'aims', actionTargetAppCode: 'finance' }
    }, 'aims', dependencies), (error: unknown) => (error as { statusCode?: number }).statusCode === 400)

    let catalogLoads = 0
    const terminal = { actionUrl: '/work-items/17', metadata: { actionableState: 'resolved', targetAppCode: 'aims' } }
    assert.equal(await bindPendingNotificationActionTarget(event, terminal, 'aims', {
      ...dependencies,
      loadApplications: async () => {
        catalogLoads += 1
        return applications
      }
    }), terminal)
    assert.equal(catalogLoads, 0)
  })

  test('maps catalog failures to a stable unavailable error', async () => {
    await assert.rejects(() => bindWorkflowNotificationActionTarget(event, {
      actionUrl: '/payments/PAY-1',
      metadata: { targetAppCode: 'finance' }
    }, 'workflow', {
      ...dependencies,
      loadApplications: async () => { throw new Error('cache path') }
    }), (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 503)
      assert.equal((error as { statusMessage?: string }).statusMessage, 'action_target_catalog_unavailable')
      return true
    })
  })

  test('canonicalizes equivalent relative paths before the idempotency hash is calculated', async () => {
    const base = {
      sourceAppCode: 'workflow',
      title: 'Approval',
      idempotencyKey: 'workflow:event:1',
      recipients: ['u1'],
      bizType: 'payment_request',
      bizId: 'PAY-1',
      metadata: {
        targetAppCode: 'finance',
        actionableKey: 'workflow:tasks:1',
        eventVersion: 'tasks:1',
        bizKey: 'finance:payment_request:PAY-1'
      }
    }
    const appRelative = await bindWorkflowNotificationActionTarget(event, { ...base, actionUrl: '/payments/PAY-1' }, 'workflow', dependencies)
    const prefixed = await bindWorkflowNotificationActionTarget(event, { ...base, actionUrl: '/finance/payments/PAY-1' }, 'workflow', dependencies)
    const actor = { appCode: 'workflow' }
    assert.equal(appRelative.actionUrl, prefixed.actionUrl)
    assert.equal(
      canonicalizePortalNotificationRequest(appRelative, actor).requestHash,
      canonicalizePortalNotificationRequest(prefixed, actor).requestHash
    )

    const independentDependencies = {
      loadApplications: async () => [{
        appCode: 'finance',
        homeUrl: 'https://finance.customer.example/',
        basePath: '/finance/',
        status: 'active'
      }],
      requestOrigin: () => 'https://console.example.test'
    }
    const independentRelative = await bindWorkflowNotificationActionTarget(event, { ...base, actionUrl: '/payments/PAY-1' }, 'workflow', independentDependencies)
    const independentPrefixed = await bindWorkflowNotificationActionTarget(event, { ...base, actionUrl: '/finance/payments/PAY-1' }, 'workflow', independentDependencies)
    assert.equal(independentRelative.actionUrl, 'https://finance.customer.example/payments/PAY-1')
    assert.equal(
      canonicalizePortalNotificationRequest(independentRelative, actor).requestHash,
      canonicalizePortalNotificationRequest(independentPrefixed, actor).requestHash
    )
  })
})

describe('integration operation notification action target binding', () => {
  const operationApps = [
    { appCode: 'aims', homeUrl: 'https://tenant.example.test/aims/', status: 'active' },
    { appCode: 'altoc', homeUrl: 'https://tenant.example.test/altoc/', status: 'active' }
  ]
  const operationDependencies = {
    loadApplications: async () => operationApps,
    requestOrigin: () => 'https://tenant.example.test'
  }

  test('binds fixed Aims and Altoc diagnostics paths to the signed catalog', async () => {
    assert.equal(await resolveRegisteredNotificationActionTarget(event, {
      actionUrl: '/integration-operations?status=dead_letter&operationId=op-1',
      actionTargetAppCode: 'aims', sourceAppCode: 'aims'
    }, operationDependencies), 'https://tenant.example.test/aims/integration-operations?status=dead_letter&operationId=op-1')
    assert.equal(await resolveRegisteredNotificationActionTarget(event, {
      actionUrl: '/admin/integration-operations?status=dead_letter&operationId=op-2',
      actionTargetAppCode: 'altoc', sourceAppCode: 'altoc'
    }, operationDependencies), 'https://tenant.example.test/altoc/admin/integration-operations?status=dead_letter&operationId=op-2')
  })

  test('fails closed when the signed application catalog is unavailable', async () => {
    await assert.rejects(resolveRegisteredNotificationActionTarget(event, {
      actionUrl: '/integration-operations?operationId=op-1',
      actionTargetAppCode: 'aims', sourceAppCode: 'aims'
    }, { ...operationDependencies, loadApplications: async () => { throw new Error('unavailable') } }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 503)
  })
})
