import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drainIntegrationOperationDeadLetterNotifications } from '../server/utils/integrationOperationDeadLetterDrain.ts'
import type {
  IntegrationOperationDeadLetterClosureInput,
  IntegrationOperationDeadLetterNotificationInput
} from '../server/utils/notifications.ts'

function candidate(overrides: Partial<IntegrationOperationDeadLetterNotificationInput> = {}): IntegrationOperationDeadLetterNotificationInput {
  return {
    tenantCode: 'tenant-1', deploymentCode: 'tenant-1-aims', sourceApp: 'aims', targetApp: 'altoc',
    operationId: '90b90bf3-5899-4aed-98c8-23dd1897f463',
    operationCode: 'aims.service-ticket.delivery-result.sync.v1', sourceBizType: 'service_ticket', sourceBizCode: 'T-1',
    attemptCount: 8, maxAttempts: 8, lastErrorCode: 'timeout', lastErrorClass: 'transient',
    deadLetteredAt: '2026-07-10T12:00:00Z', originalActorUid: 'U001',
    generation: 1, operationVersion: 9,
    actionableKey: 'aims:integration-operation:90b90bf3-5899-4aed-98c8-23dd1897f463:g1',
    objectVersion: 'dead-letter:g1:v9', ...overrides
  }
}

function closure(overrides: Partial<IntegrationOperationDeadLetterClosureInput> = {}): IntegrationOperationDeadLetterClosureInput {
  return {
    tenantCode: 'tenant-1', deploymentCode: 'tenant-1-aims', sourceApp: 'aims',
    operationId: '90b90bf3-5899-4aed-98c8-23dd1897f463', generation: 1,
    actionableKey: 'aims:integration-operation:90b90bf3-5899-4aed-98c8-23dd1897f463:g1',
    expectedVersion: 'dead-letter:g1:v9', nextVersion: 'resolved:g1:v12', state: 'resolved',
    ...overrides
  }
}

describe('integration operation dead-letter drain', () => {
  test('publishes before acknowledging the exact Console notification id', async () => {
    const calls: Array<{ path: string, body: Record<string, unknown> }> = []
    const result = await drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string, body: Record<string, unknown>) => {
        calls.push({ path, body })
        if (path.endsWith('pending-dead-letter-actionables')) return { items: [candidate()] } as T
        if (path.endsWith('pending-dead-letter-closures')) return { items: [] } as T
        return {} as T
      },
      publish: async () => ({ notificationId: 'notif_stable', recipients: ['U001'] })
    })
    assert.deepEqual(result, { published: 1, closed: 0, failures: 0 })
    assert.deepEqual(calls[1], {
      path: '/v1/aims/integration-operations/90b90bf3-5899-4aed-98c8-23dd1897f463:dead-letter-actionable-published',
      body: {
        notificationId: 'notif_stable', recipientUids: ['U001'], generation: 1, operationVersion: 9,
        actionableKey: candidate().actionableKey, objectVersion: candidate().objectVersion
      }
    })
  })

  test('recovers acknowledgement loss by republishing idempotently then acknowledging', async () => {
    let run = 0
    let acknowledgeAttempts = 0
    const publishIds: string[] = []
    const execute = async () => drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string) => {
        if (path.endsWith('pending-dead-letter-actionables')) return { items: [candidate()] } as T
        if (path.endsWith('pending-dead-letter-closures')) return { items: [] } as T
        acknowledgeAttempts += 1
        if (run === 0) throw new Error('ack response lost')
        return {} as T
      },
      publish: async () => {
        publishIds.push('notif_stable')
        return { notificationId: 'notif_stable', recipients: ['U001'] }
      }
    })

    assert.deepEqual(await execute(), { published: 0, closed: 0, failures: 1 })
    run = 1
    assert.deepEqual(await execute(), { published: 1, closed: 0, failures: 0 })
    assert.deepEqual(publishIds, ['notif_stable', 'notif_stable'])
    assert.equal(acknowledgeAttempts, 2)
  })

  test('does not publish candidates outside the trusted binding', async () => {
    let published = false
    await assert.rejects(drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string) => (path.endsWith('pending-dead-letter-actionables')
        ? { items: [candidate({ tenantCode: 'tenant-2' })] }
        : { items: [] }) as T,
      publish: async () => {
        published = true
        return { notificationId: 'never' }
      }
    }), /escaped/)
    assert.equal(published, false)
  })

  test('leaves source evidence pending when Console publish fails', async () => {
    let acknowledged = false
    const result = await drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string) => {
        if (path.endsWith('pending-dead-letter-actionables')) return { items: [candidate()] } as T
        if (path.endsWith('pending-dead-letter-closures')) return { items: [] } as T
        acknowledged = true
        return {} as T
      },
      publish: async () => { throw new Error('Console unavailable') }
    })
    assert.deepEqual(result, { published: 0, closed: 0, failures: 1 })
    assert.equal(acknowledged, false)
  })

  test('closes with source-frozen versions before acknowledging source evidence', async () => {
    const calls: Array<{ path: string, body: Record<string, unknown> }> = []
    const consoleInputs: unknown[] = []
    const result = await drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string, body: Record<string, unknown>) => {
        calls.push({ path, body })
        if (path.endsWith('pending-dead-letter-actionables')) return { items: [] } as T
        if (path.endsWith('pending-dead-letter-closures')) return { items: [closure()] } as T
        return {} as T
      },
      publish: async (input) => {
        consoleInputs.push(input)
        return {}
      }
    })
    assert.deepEqual(result, { published: 0, closed: 1, failures: 0 })
    assert.deepEqual(consoleInputs, [closure()])
    assert.deepEqual(calls[2], {
      path: '/v1/aims/integration-operations/90b90bf3-5899-4aed-98c8-23dd1897f463:dead-letter-closure-acknowledged',
      body: {
        generation: 1, actionableKey: closure().actionableKey,
        expectedVersion: closure().expectedVersion, nextVersion: closure().nextVersion, state: 'resolved'
      }
    })
  })

  test('retries closure after Console success acknowledgement is lost', async () => {
    let ackAttempts = 0
    let first = true
    const execute = () => drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string) => {
        if (path.endsWith('pending-dead-letter-actionables')) return { items: [] } as T
        if (path.endsWith('pending-dead-letter-closures')) return { items: [closure()] } as T
        ackAttempts += 1
        if (first) throw new Error('closure ack lost')
        return {} as T
      },
      publish: async () => ({})
    })
    assert.deepEqual(await execute(), { published: 0, closed: 0, failures: 1 })
    first = false
    assert.deepEqual(await execute(), { published: 0, closed: 1, failures: 0 })
    assert.equal(ackAttempts, 2)
  })

  for (const [name, recipients] of [
    ['empty', []], ['broadcast', ['@all']], ['control', ['U001\nadmin']],
    ['long uid', ['x'.repeat(129)]], ['too many', Array.from({ length: 101 }, (_, index) => `U${index}`)]
  ] as const) {
    test(`rejects ${name} recipient evidence before source acknowledgement`, async () => {
      let acknowledged = false
      const result = await drainIntegrationOperationDeadLetterNotifications('aims', {
        tenant: 'tenant-1', deployment: 'tenant-1-aims'
      }, {
        callRuntime: async <T>(path: string) => {
          if (path.endsWith('pending-dead-letter-actionables')) return { items: [candidate()] } as T
          if (path.endsWith('pending-dead-letter-closures')) return { items: [] } as T
          acknowledged = true
          return {} as T
        },
        publish: async () => ({ notificationId: 'notif_stable', recipients: [...recipients] })
      })
      assert.deepEqual(result, { published: 0, closed: 0, failures: 1 })
      assert.equal(acknowledged, false)
    })
  }

  test('falls back to the legacy publish endpoint only when the actionable API is unavailable', async () => {
    const paths: string[] = []
    const result = await drainIntegrationOperationDeadLetterNotifications('aims', {
      tenant: 'tenant-1', deployment: 'tenant-1-aims'
    }, {
      callRuntime: async <T>(path: string) => {
        paths.push(path)
        if (path.endsWith('pending-dead-letter-actionables')) throw Object.assign(new Error('missing'), { statusCode: 404 })
        if (path.endsWith('pending-failure-notifications')) return { items: [candidate({ generation: undefined, operationVersion: undefined, actionableKey: undefined, objectVersion: undefined })] } as T
        if (path.endsWith('pending-dead-letter-closures')) throw Object.assign(new Error('missing'), { statusCode: 404 })
        return {} as T
      },
      publish: async () => ({ notificationId: 'legacy-notification', recipients: ['U001'] })
    })
    assert.deepEqual(result, { published: 1, closed: 0, failures: 0 })
    assert.ok(paths.some(path => path.endsWith(':failure-notified')))
  })
})
