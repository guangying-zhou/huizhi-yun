import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  platformLifecycleActionableIdentity,
  platformLifecycleActionableMetadata,
  platformLifecycleClosure
} from '../server/utils/platformLifecycleActionable.ts'

const operationId = '550e8400-e29b-41d4-a716-446655440000'

test('Console lifecycle dead-letter identity is stable, opaque and generation-scoped', () => {
  const first = platformLifecycleActionableIdentity({ operationId, uid: 'employee-42', phase: 'employment_authorization_sync' })
  const replay = platformLifecycleActionableIdentity({ operationId, uid: 'employee-42', phase: 'employment_authorization_sync' })
  const next = platformLifecycleActionableIdentity({ operationId, uid: 'employee-42', phase: 'employment_authorization_sync', generation: 2 })
  assert.deepEqual(first, replay)
  assert.notEqual(first.actionableKey, next.actionableKey)
  assert.match(first.actionableKey, /^console:platform-lifecycle:[a-f0-9]{48}:g1$/)
  assert.doesNotMatch(first.actionableKey, /employee-42|550e8400/)
})

test('pending lifecycle actionable is restricted to Console, exact descriptor and a catalog-bound target', () => {
  const identity = platformLifecycleActionableIdentity({ operationId, uid: 'employee-42', phase: 'offboarding_authorization_reclaim' })
  assert.deepEqual(platformLifecycleActionableMetadata(identity), {
    actionableState: 'pending', actionableKey: identity.actionableKey, objectVersion: identity.objectVersion,
    eventVersion: identity.objectVersion, targetAppCode: 'console', actionTargetAppCode: 'console',
    actionTargetCatalogBinding: 'catalog-v1', bizKey: 'console:people_lifecycle_authorization:employee-42',
    authorizationDescriptor: { resource: 'people_lifecycle_authorization', id: 'employee-42' }, generation: 1
  })
})

test('closure uses the frozen object version and distinct deterministic terminal version', () => {
  const identity = platformLifecycleActionableIdentity({ operationId, uid: 'employee-42', phase: 'employment_authorization_sync' })
  assert.deepEqual(platformLifecycleClosure(identity, 'resolved'), {
    sourceAppCode: 'console', actionableKey: identity.actionableKey,
    expectedVersion: 'dead-letter:g1', nextVersion: 'dead-letter:g1:resolved', state: 'resolved'
  })
})

test('task uses durable source outbox before portal publish and retries closure through projection CAS', () => {
  const source = readFileSync(new URL('../server/utils/platformLifecycleActionableDrain.ts', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../../data-runtime/internal/apps/console/platform_lifecycle_actionables.go', import.meta.url), 'utf8')
  const task = readFileSync(new URL('../server/tasks/integrations/platform-lifecycle.ts', import.meta.url), 'utf8')
  const migration = readFileSync(new URL('../docs/platform_lifecycle_actionable_reliability_20260711.sql', import.meta.url), 'utf8')
  assert.match(source, /\/v1\/console\/platform-lifecycle\/actionables\/prepare/)
  assert.match(source, /\/v1\/console\/platform-lifecycle\/actionables\/checkpoint/)
  assert.match(runtime, /console_platform_lifecycle_actionables/)
  assert.match(runtime, /recipient_uids_json IS NULL/)
  assert.match(source, /publishPortalNotification/)
  assert.match(source, /advancePortalActionableLifecycleForService/)
  assert.match(source, /row\.status === 'succeeded' \? 'resolved' : 'cancelled'/)
  assert.doesNotMatch(source, /server\/utils\/db|queryRow|execute|withTransaction/)
  assert.match(task, /drainPlatformLifecycleActionables/)
  assert.match(migration, /PRIMARY KEY \(`operation_id`, `generation`\)/)
  assert.match(migration, /recipient_uids_json/)
})
