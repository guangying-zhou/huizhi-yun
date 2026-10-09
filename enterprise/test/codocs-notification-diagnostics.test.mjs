import test from 'node:test'
import assert from 'node:assert/strict'
import { codocsNotificationFailureDiagnostics } from '../server/utils/codocsNotificationFailure.ts'

test('notification diagnostics distinguish failure stages without identities or raw errors', () => {
  const reason = { statusCode: 403, data: { code: 'insufficient_scope', token: 'secret' }, message: 'receiver secret' }
  assert.deepEqual(codocsNotificationFailureDiagnostics({ result: { inApp: { status: 'rejected', reason }, external: { status: 'skipped' } }, recipients: ['private-uid'] }), [{ stage: 'notification_in_app', httpStatus: 403, errorCode: 'insufficient_scope' }])
  assert.deepEqual(codocsNotificationFailureDiagnostics({ result: { inApp: { status: 'fulfilled' }, external: { status: 'rejected', reason: { status: 503, code: 'hzy0_upstream_error' } } } }), [{ stage: 'notification_external', httpStatus: 503, errorCode: 'hzy0_upstream_error' }])
  assert.deepEqual(codocsNotificationFailureDiagnostics({ message: 'token-person', code: 'arbitrary-secret', statusCode: 999 }), [{ stage: 'notification_dispatch', httpStatus: null, errorCode: 'unknown' }])
})
