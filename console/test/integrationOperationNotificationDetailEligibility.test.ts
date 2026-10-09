import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  authorizeNotificationDetailAfterFreshEligibility,
  authorizeIntegrationOperationDetailAfterFreshEligibility,
  IntegrationOperationDetailEligibilityError
} from '../server/utils/integrationOperationNotificationDetailEligibility.ts'
import {
  notificationDetailEligibilityRegistry,
  notificationDetailEligibilityTarget
} from '../server/utils/subjectEligibilityContract.ts'

describe('integration operation notification detail eligibility', () => {
  for (const [name, sourceAppCode, eligibility] of [
    ['revoked permission', 'assets', { active: true, allowed: false }],
    ['inactive subject', 'people', { active: false, allowed: false }]
  ] as const) {
    test(`${name} stops before the source verifier`, async () => {
      let sourceCalls = 0
      await assert.rejects(authorizeIntegrationOperationDetailAfterFreshEligibility({
        sourceAppCode, resource: 'integration_operation',
        evaluate: async () => eligibility,
        authorizeSource: async () => { sourceCalls += 1 }
      }), (error: unknown) => error instanceof IntegrationOperationDetailEligibilityError && error.code === 'restricted')
      assert.equal(sourceCalls, 0)
    })
  }

  test('Directory or fresh policy failure is unavailable and does not call the source', async () => {
    let sourceCalls = 0
    await assert.rejects(authorizeIntegrationOperationDetailAfterFreshEligibility({
      sourceAppCode: 'altoc', resource: 'integration_operation',
      evaluate: async () => { throw new Error('policy unavailable') },
      authorizeSource: async () => { sourceCalls += 1 }
    }), (error: unknown) => error instanceof IntegrationOperationDetailEligibilityError && error.code === 'unavailable')
    assert.equal(sourceCalls, 0)
  })

  test('active subject with fresh view permission proceeds to the source verifier', async () => {
    let sourceCalls = 0
    await authorizeIntegrationOperationDetailAfterFreshEligibility({
      sourceAppCode: 'aims', resource: 'integration_operation',
      evaluate: async () => ({ active: true, allowed: true }),
      authorizeSource: async () => { sourceCalls += 1 }
    })
    assert.equal(sourceCalls, 1)
  })

  test('every persisted source descriptor maps to one fixed declared minimum-view resource', () => {
    const registry = notificationDetailEligibilityRegistry()
    assert.deepEqual([...registry.keys()].sort(), [
      'aims|integration_operation', 'aims|webdev_issue', 'aims|work_item',
      'altoc|integration_operation', 'altoc|receivable_plan',
      'assets|asset_item', 'assets|customer_delivery_asset', 'assets|integration_operation', 'assets|ip_asset', 'assets|offboarding_recovery_case',
      'finance|finance_receipt', 'finance|integration_operation', 'finance|invoice_request',
      'people|integration_operation', 'people|offboarding_task',
      'workflow|workflow_instance', 'workflow|workflow_task'
    ])
    for (const [key, resourceCode] of registry) {
      const [sourceAppCode, resource] = key.split('|')
      const manifest = JSON.parse(readFileSync(new URL(`../../${sourceAppCode}/app.manifest.json`, import.meta.url), 'utf8')) as {
        resources: Array<{ code: string, actions: string[] }>
      }
      assert.ok(
        manifest.resources.some(entry => entry.code === resourceCode && entry.actions.includes('view')),
        `${key} must use a declared ${sourceAppCode}:${resourceCode}:view permission`
      )
      assert.deepEqual(notificationDetailEligibilityTarget(sourceAppCode, resource), {
        targetAppCode: sourceAppCode,
        resourceCode,
        action: 'view'
      })
    }
    assert.equal(notificationDetailEligibilityTarget('assets', 'admin'), null)
    assert.equal(notificationDetailEligibilityTarget('console', 'people_lifecycle_authorization'), null)
  })

  test('all registered source descriptors stop before source authorization on revocation, inactive Directory, or policy failure', async () => {
    for (const [key, expectedResource] of notificationDetailEligibilityRegistry()) {
      const [sourceAppCode, resource] = key.split('|')
      for (const [name, outcome] of [
        ['revoked', async () => ({ active: true, allowed: false })],
        ['inactive', async () => ({ active: false, allowed: false })],
        ['unavailable', async () => { throw new Error('fresh policy unavailable') }]
      ] as const) {
        let sourceCalls = 0
        await assert.rejects(authorizeNotificationDetailAfterFreshEligibility({
          sourceAppCode,
          resource,
          eligibilityTarget: notificationDetailEligibilityTarget(sourceAppCode, resource),
          evaluate: async (target) => {
            assert.equal(target.resourceCode, expectedResource, `${key} cannot accept a caller-selected permission`)
            return await outcome()
          },
          authorizeSource: async () => { sourceCalls += 1 }
        }), (error: unknown) => error instanceof IntegrationOperationDetailEligibilityError
          && error.code === (name === 'unavailable' ? 'unavailable' : 'restricted'))
        assert.equal(sourceCalls, 0, `${key} ${name} must not invoke its source verifier`)
      }
    }
  })

  test('an unregistered descriptor fails closed without contacting a source verifier', async () => {
    let sourceCalls = 0
    await assert.rejects(authorizeNotificationDetailAfterFreshEligibility({
      sourceAppCode: 'assets',
      resource: 'admin',
      eligibilityTarget: notificationDetailEligibilityTarget('assets', 'admin'),
      evaluate: async () => ({ active: true, allowed: true }),
      authorizeSource: async () => { sourceCalls += 1 }
    }), (error: unknown) => error instanceof IntegrationOperationDetailEligibilityError && error.code === 'unavailable')
    assert.equal(sourceCalls, 0)
  })
})
