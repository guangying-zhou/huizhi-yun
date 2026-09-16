import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consoleSessionActorContext,
  shouldResolveConsoleSessionActor
} from '../server/utils/consoleSessionActor.ts'

test('resolves local Console sessions for Runtime-bound browser mutations', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(
      shouldResolveConsoleSessionActor('/api/v1/console/connector-runtime/install-command', method),
      true
    )
    assert.equal(
      shouldResolveConsoleSessionActor('/console/api/v1/console/connector-runtime/install-command', method),
      true
    )
  }
})

test('keeps Console reads and unrelated application APIs out of the session actor bridge', () => {
  assert.equal(
    shouldResolveConsoleSessionActor('/api/v1/console/connector-runtime', 'GET'),
    false
  )
  assert.equal(
    shouldResolveConsoleSessionActor('/api/v1/people/employees', 'POST'),
    false
  )
})

test('resolves local Console sessions for user-scoped notification reads', () => {
  for (const pathname of [
    '/api/notifications',
    '/api/notifications/summary',
    '/console/api/notifications/notification-1/detail',
    '/api/v1/console/notifications',
    '/console/api/v1/console/notifications/summary',
    '/console/api/v1/console/notifications/notification-1/detail'
  ]) {
    assert.equal(shouldResolveConsoleSessionActor(pathname, 'GET'), true)
  }
})

test('resolves local Console sessions for authorization lifecycle audit reads', () => {
  for (const pathname of [
    '/api/v1/console/authorization-lifecycle/operations',
    '/console/api/v1/console/authorization-lifecycle/operations',
    '/console/api/v1/console/authorization-lifecycle/operations/operation-1/attempts'
  ]) {
    assert.equal(shouldResolveConsoleSessionActor(pathname, 'GET'), true)
  }
})

test('resolves local Console sessions for actor-bound directory connector reads', () => {
  for (const pathname of [
    '/api/v1/console/directory/me/password-capability',
    '/console/api/v1/console/directory/me/password-capability',
    '/api/v1/console/directory/operations/operation-1',
    '/console/api/v1/console/directory/operations/operation-1'
  ]) {
    assert.equal(shouldResolveConsoleSessionActor(pathname, 'GET'), true)
  }

  assert.equal(
    shouldResolveConsoleSessionActor('/api/v1/console/directory/provisioning', 'GET'),
    false
  )
})

test('hydrates a trusted runtime user actor from the verified Console session', () => {
  assert.deepEqual(
    consoleSessionActorContext({
      uid: 'U1001',
      user: { primaryDeptCode: 'D001' }
    }, {
      authenticated: true,
      subjectType: 'service',
      tokenUse: 'service'
    }),
    {
      authenticated: true,
      subjectType: 'user',
      tokenUse: 'console_session',
      uid: 'U1001',
      subjectCode: 'U1001',
      deptCode: 'D001',
      deptCodes: ['D001']
    }
  )
})

test('continues to resolve Workflow proxy requests', () => {
  assert.equal(
    shouldResolveConsoleSessionActor('/api/workflow-proxy/v1/instances', 'GET'),
    true
  )
  assert.equal(
    shouldResolveConsoleSessionActor('/console/api/workflow-proxy/v1/instances', 'GET'),
    true
  )
})

test('resolves local Console sessions for Foundation feedback routes', () => {
  for (const method of ['GET', 'POST']) {
    assert.equal(
      shouldResolveConsoleSessionActor('/api/webdev-report/issues', method),
      true
    )
    assert.equal(
      shouldResolveConsoleSessionActor('/console/api/webdev-report/issues', method),
      true
    )
  }
})
