import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  recordWorkflowResultNotificationPublishFailure,
  workflowResultNotificationPublishFailures
} from '../server/utils/runtimeNotifications.ts'

test('a result notification publish failure increments the counter and logs only the fixed, allowed fields', () => {
  const before = workflowResultNotificationPublishFailures()
  const logged: unknown[] = []
  recordWorkflowResultNotificationPublishFailure({
    instanceId: 88,
    eventType: 'workflow.instance.approved',
    causeStatus: 502,
    causeClass: 'FetchError',
    causeCode: 'console_publish_failed'
  }, (_message, detail) => logged.push(detail))
  assert.equal(workflowResultNotificationPublishFailures(), before + 1)
  assert.deepEqual(logged, [{
    code: 'workflow_result_notification_publish_failed',
    instanceId: 88,
    eventType: 'workflow.instance.approved',
    causeStatus: 502,
    causeClass: 'FetchError',
    causeCode: 'console_publish_failed'
  }])
})

test('unsafe or out-of-range cause fields are dropped, and optional fields are omitted rather than logged as empty', () => {
  const before = workflowResultNotificationPublishFailures()
  const logged: unknown[] = []
  recordWorkflowResultNotificationPublishFailure({
    eventType: 'workflow.instance.withdrawn',
    causeStatus: 999,
    causeClass: 'Bearer secret-token-class!!',
    causeCode: 'Bearer secret'
  }, (_message, detail) => logged.push(detail))
  assert.equal(workflowResultNotificationPublishFailures(), before + 1)
  assert.deepEqual(logged, [{
    code: 'workflow_result_notification_publish_failed',
    eventType: 'workflow.instance.withdrawn'
  }])
  assert.doesNotMatch(JSON.stringify(logged), /secret/)
})

test('the default logger is console.error and never receives title, body, URL, recipients or tokens', () => {
  const originalError = console.error
  const captured: unknown[] = []
  console.error = (..._args: unknown[]) => {
    captured.push(_args)
  }
  try {
    recordWorkflowResultNotificationPublishFailure({
      instanceId: 1,
      eventType: 'workflow.instance.rejected',
      causeCode: 'workflow_notification_publish_failed'
    })
  } finally {
    console.error = originalError
  }
  assert.equal(captured.length, 1)
  assert.doesNotMatch(JSON.stringify(captured), /title|body|touser|url|token/i)
})

test('the drain response exposes the counter as a process-lifetime total next to checkpointTokenDenied', () => {
  const endpoint = readFileSync(new URL('../server/api/internal/integration-operations/drain.post.ts', import.meta.url), 'utf8')
  assert.match(endpoint, /import \{ workflowResultNotificationPublishFailures \} from '~~\/server\/utils\/runtimeNotifications'/)
  assert.match(endpoint, /resultNotificationPublishFailed: \{\s*processTotal: workflowResultNotificationPublishFailures\(\)\s*\}/)
})
