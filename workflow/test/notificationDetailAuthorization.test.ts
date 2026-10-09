import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Workflow notification detail authorization', () => {
  test('uses the Console-only service contract and current subject runtime check', () => {
    const route = source('server/api/v1/service/notification-details/authorize.post.ts')
    assert.match(route, /workflow:notification-details:authorize/)
    // The viewer travels as a signed notification-detail actor; a body
    // current_user would be replaced by the service identity in Runtime.
    assert.match(route, /notificationDetailActor: \{\s*uid: caller\.subjectUid,\s*tenantId: caller\.tenantId,\s*deploymentId: caller\.deploymentId\s*\}/)
    assert.doesNotMatch(route, /current_user/)
    const wrapper = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
    assert.match(wrapper, /notificationDetailActor: options\.notificationDetailActor/)
    assert.match(route, /\/v1\/workflow\/notification-details\/authorize/)
    assert.doesNotMatch(route, /getRequestUid|x-hzy-actor-uid|cookie/)
  })

  test('notification metadata stores only a normalized source authorization descriptor', () => {
    const runtime = source('../data-runtime/internal/apps/workflow/notifications.go')
    assert.match(runtime, /authorizationDescriptor/)
    assert.match(runtime, /workflowTaskAuthorizationIdentity/)
    assert.match(runtime, /"resource": "workflow_instance"/)
  })
})
