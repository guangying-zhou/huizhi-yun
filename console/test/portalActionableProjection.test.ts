import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  PortalActionableProjectionError,
  validatePortalActionableLifecycleInput
} from '../server/utils/portalActionableProjection.ts'
import {
  derivePortalActionableDescriptor,
  PortalNotificationPublishError
} from '../server/utils/portalNotificationIdempotency.ts'

function descriptor() {
  const value = derivePortalActionableDescriptor({
    sourceAppCode: 'workflow',
    eventType: 'workflow.task.created',
    category: 'approval',
    actionUrl: 'https://tenant.example/workflow/tasks/11',
    bizType: 'project_approval',
    bizId: 'P-1',
    metadata: {
      actionableKey: 'workflow:tasks:sha256:generation-1',
      eventVersion: 'flow_tasks:sha256:generation-1',
      bizKey: 'aims:project_approval:P-1',
      targetAppCode: 'aims',
      actionTargetAppCode: 'aims',
      actionTargetCatalogBinding: 'catalog-v1'
    }
  })
  assert.ok(value)
  return value
}

describe('portal actionable Console boundary', () => {
  test('derives a catalog-bound pending descriptor without persistence code', () => {
    assert.deepEqual(descriptor(), {
      sourceAppCode: 'workflow',
      actionableKey: 'workflow:tasks:sha256:generation-1',
      targetAppCode: 'aims',
      bizType: 'project_approval',
      bizId: 'P-1',
      businessKey: 'aims:project_approval:P-1',
      state: 'pending',
      objectVersion: 'flow_tasks:sha256:generation-1',
      previousObjectVersion: null
    })
    const source = readFileSync(new URL('../server/utils/portalNotificationIdempotency.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(source, /SELECT |INSERT INTO|UPDATE |mysql2|queryRow|execute/)
  })

  test('rejects missing pending target identity', () => {
    assert.throws(
      () => derivePortalActionableDescriptor({
        sourceAppCode: 'workflow', eventType: 'workflow.task.created', category: 'approval',
        actionUrl: '/workflow/tasks/1', bizType: 'approval', bizId: 'A-1',
        metadata: { actionableKey: 'workflow:task:1', eventVersion: 'v1', bizKey: 'workflow:approval:A-1' }
      }),
      (error: unknown) => error instanceof PortalNotificationPublishError
        && error.code === 'invalid_target_app_code'
    )
  })

  test('validates source-bound terminal lifecycle requests before Runtime', () => {
    assert.deepEqual(validatePortalActionableLifecycleInput({
      sourceAppCode: 'workflow', actionableKey: 'task:g1',
      expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved',
      recipients: ['u2', 'u1', 'u2']
    }, { appCode: 'workflow' }), {
      sourceAppCode: 'workflow', actionableKey: 'task:g1',
      expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved',
      recipients: ['u1', 'u2']
    })
    assert.throws(
      () => validatePortalActionableLifecycleInput({
        sourceAppCode: 'aims', actionableKey: 'task:g1',
        expectedVersion: 'v1', nextVersion: 'v2', state: 'resolved'
      }, { appCode: 'workflow' }),
      (error: unknown) => error instanceof PortalActionableProjectionError
        && error.code === 'source_app_mismatch'
    )
  })

  test('Runtime owns projection CAS, replay and terminal persistence', () => {
    const runtime = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications_write.go', import.meta.url), 'utf8')
    assert.match(runtime, /FROM portal_actionable_projections/)
    assert.match(runtime, /FOR UPDATE/)
    assert.match(runtime, /state='pending' AND object_version=\?/)
    assert.match(runtime, /actionable_version_conflict/)
    assert.match(runtime, /actionable_cas_conflict/)
  })
})

describe('portal actionable API contracts', () => {
  test('service lifecycle authenticates before payload and user summary binds current user', () => {
    const lifecycle = readFileSync(new URL('../server/api/v1/console/notifications/actionable-lifecycle.post.ts', import.meta.url), 'utf8')
    const summary = readFileSync(new URL('../server/api/v1/console/notifications/todos/summary.get.ts', import.meta.url), 'utf8')
    assert.ok(lifecycle.indexOf('requireConsoleServiceActor(event, \'notifications\', \'notifications:publish\')') < lifecycle.indexOf('readBody(event)'))
    assert.match(lifecycle, /advancePortalActionableLifecycleForService\(body, actor, event\)/)
    assert.ok(summary.indexOf('requireNotificationUserUid(event)') < summary.indexOf('getUserTodoSummary(event)'))
  })

  test('dashboard reads the Runtime actionable summary', () => {
    const page = readFileSync(new URL('../app/pages/index.vue', import.meta.url), 'utf8')
    const server = readFileSync(new URL('../server/utils/notifications.ts', import.meta.url), 'utf8')
    const runtime = readFileSync(new URL('../../data-runtime/internal/apps/console/notifications_write.go', import.meta.url), 'utf8')
    assert.match(page, /\/api\/v1\/console\/notifications\/todos\/summary/)
    assert.match(page, /todoSummary\.value\.totalPending/)
    assert.match(server, /getConsoleUserNotificationTodoSummary\(event\)/)
    assert.match(runtime, /FROM portal_actionable_projections p/)
    assert.match(runtime, /WHERE p\.uid=\? AND p\.state='pending'/)
  })
})
