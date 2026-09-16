import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  orchestrateEmploymentLifecycle,
  orchestrateOffboardingLifecycle,
  type DirectoryLifecycleFailureNotificationInput,
  type DirectoryLifecycleOperationLog
} from '../server/utils/directoryLifecycleOrchestration.ts'

describe('Directory lifecycle orchestration behavior', () => {
  test('employment keeps Directory projection when Platform fails and returns retry evidence', async () => {
    const events: string[] = []
    const logs: DirectoryLifecycleOperationLog[] = []
    const notifications: DirectoryLifecycleFailureNotificationInput[] = []
    let directoryApplied = false

    const retryNotification = {
      ok: true,
      notificationId: 'notification-employment-1',
      retry: {
        endpoint: '/api/v1/console/authorization-lifecycle/retry',
        phase: 'employment_authorization_sync'
      }
    }

    const result = await orchestrateEmploymentLifecycle({
      uid: 'u001',
      sourceApp: 'people',
      actorId: 'people-client',
      operatorUid: 'hr001',
      reason: 'people_assignment_membership_projection',
      idempotencyKey: 'idem-employment-1',
      created: false,
      primaryDeptCode: 'dept-delivery',
      positionCode: 'delivery_pm',
      positionName: '交付经理',
      employmentStatus: 'active'
    }, {
      applyDirectoryProjection: async () => {
        events.push('directory')
        directoryApplied = true
      },
      syncPlatformAuthorization: async (input) => {
        events.push('platform')
        assert.equal(directoryApplied, true)
        assert.deepEqual(input, {
          uid: 'u001',
          sourceApp: 'people',
          positionCode: 'delivery_pm',
          positionName: '交付经理',
          deptCode: 'dept-delivery',
          operatorUid: 'hr001',
          reason: 'people_assignment_membership_projection',
          idempotencyKey: 'idem-employment-1'
        })
        throw new Error('platform employment unavailable')
      },
      notifyFailure: async (input) => {
        events.push('notification')
        notifications.push(input)
        return retryNotification
      },
      writeOperationLog: async (input) => {
        events.push('operation-log')
        logs.push(input)
      },
      loadDirectoryUser: async () => {
        events.push('directory-read')
        return { uid: 'u001', status: 'active', primaryDeptCode: 'dept-delivery' }
      },
      warn: () => {}
    })

    assert.deepEqual(events, ['directory', 'platform', 'notification', 'operation-log', 'directory-read'])
    assert.equal(directoryApplied, true)
    assert.deepEqual(notifications, [{
      uid: 'u001',
      operatorUid: 'hr001',
      idempotencyKey: 'idem-employment-1',
      phase: 'employment_authorization_sync',
      message: 'platform employment unavailable',
      sourceApp: 'people'
    }])
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.action, 'directory.user.employment.from_people')
    assert.equal(logs[0]?.detail.authorizationSync && (logs[0].detail.authorizationSync as { ok: boolean }).ok, false)
    assert.deepEqual(result, {
      user: { uid: 'u001', status: 'active', primaryDeptCode: 'dept-delivery' },
      created: false,
      authorizationSync: {
        ok: false,
        error: 'platform employment unavailable',
        notification: retryNotification
      },
      idempotencyKey: 'idem-employment-1'
    })
  })

  test('offboarding keeps account/session revocation when Platform fails and returns retry evidence', async () => {
    const events: string[] = []
    const logs: DirectoryLifecycleOperationLog[] = []
    const notifications: DirectoryLifecycleFailureNotificationInput[] = []
    let directoryStatus = 'active'
    let sessionsRevoked = false

    const retryNotification = {
      ok: true,
      notificationId: 'notification-offboarding-1',
      retry: {
        endpoint: '/api/v1/console/authorization-lifecycle/retry',
        phase: 'offboarding_authorization_reclaim'
      }
    }

    const result = await orchestrateOffboardingLifecycle({
      uid: 'u002',
      sourceApp: 'people',
      actorId: 'people-client',
      operatorUid: 'hr002',
      reason: 'people_assignment_leave_offboarding',
      leaveDate: '2026-07-31',
      idempotencyKey: 'idem-offboarding-1',
      existingStatus: 'active'
    }, {
      deactivateDirectoryUser: async (uid) => {
        events.push('directory-inactive')
        assert.equal(uid, 'u002')
        directoryStatus = 'inactive'
      },
      revokeUserSessions: async (uid) => {
        events.push('sessions-revoked')
        assert.equal(uid, 'u002')
        assert.equal(directoryStatus, 'inactive')
        sessionsRevoked = true
        return { refreshTokens: 2, sessions: 3 }
      },
      reclaimPlatformAuthorization: async (input) => {
        events.push('platform')
        assert.equal(directoryStatus, 'inactive')
        assert.equal(sessionsRevoked, true)
        assert.equal(input.idempotencyKey, 'idem-offboarding-1')
        throw new Error('platform offboarding unavailable')
      },
      notifyFailure: async (input) => {
        events.push('notification')
        notifications.push(input)
        return retryNotification
      },
      loadDirectoryUser: async () => {
        events.push('directory-read')
        return { uid: 'u002', status: directoryStatus }
      },
      writeOperationLog: async (input) => {
        events.push('operation-log')
        logs.push(input)
      },
      warn: () => {}
    })

    assert.deepEqual(events, [
      'directory-inactive',
      'sessions-revoked',
      'platform',
      'notification',
      'directory-read',
      'operation-log'
    ])
    assert.equal(directoryStatus, 'inactive')
    assert.equal(sessionsRevoked, true)
    assert.deepEqual(notifications, [{
      uid: 'u002',
      operatorUid: 'hr002',
      idempotencyKey: 'idem-offboarding-1',
      phase: 'offboarding_authorization_reclaim',
      message: 'platform offboarding unavailable',
      sourceApp: 'people'
    }])
    assert.equal(logs.length, 1)
    assert.equal(logs[0]?.action, 'directory.user.disable.from_people')
    assert.deepEqual(logs[0]?.detail.revoked, { refreshTokens: 2, sessions: 3 })
    assert.equal(logs[0]?.detail.authorizationReclaim && (logs[0].detail.authorizationReclaim as { ok: boolean }).ok, false)
    assert.deepEqual(result, {
      uid: 'u002',
      status: 'inactive',
      disabled: true,
      alreadyDisabled: false,
      revoked: { refreshTokens: 2, sessions: 3 },
      authorizationReclaim: {
        ok: false,
        error: 'platform offboarding unavailable',
        notification: retryNotification
      },
      idempotencyKey: 'idem-offboarding-1'
    })
  })
})
