import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolvePeopleDirectoryEmploymentProjection } from '../server/utils/peopleDirectoryProjection.ts'
import { resolvePeopleOffboardingProjection } from '../server/utils/peopleOffboardingProjection.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('People workflow callback projection', () => {
  test('normalizes Workflow payload keys before calling data-runtime', () => {
    const content = source('server/utils/peopleWorkflowCallbackProjection.ts')

    assert.match(content, /'resource_code', 'resourceCode'/)
    assert.match(content, /'workflow_instance_id', 'workflowInstanceId', 'instance_id', 'instanceId'/)
    assert.match(content, /'approval_operator_uid', 'operator_uid', 'operatorUid'/)
    assert.match(content, /case 'success':\n\s+return 'approved'/)
    assert.match(content, /biz_type: bizType/)
    assert.match(content, /workflow_instance_id: workflowInstanceId/)
  })

  test('approved non-leave assignment projects active employment', () => {
    assert.deepEqual(
      resolvePeopleDirectoryEmploymentProjection(
        '/assignments',
        'POST',
        {
          assignment_code: 'ASN-002',
          employee_uid: 'u001',
          change_type: 'transfer',
          dept_code: 'dept-delivery',
          position_code: 'delivery_pm',
          position_name: '交付经理',
          operator_uid: 'approver-2'
        }
      ),
      {
        employeeUid: 'u001',
        loginName: '',
        displayName: '',
        realName: '',
        deptCode: 'dept-delivery',
        positionCode: 'delivery_pm',
        positionName: '交付经理',
        employmentStatus: 'active',
        operatorUid: 'approver-2',
        reason: 'people_assignment_membership_projection'
      }
    )
  })

  test('approved leave assignment projects offboarding only', () => {
    assert.deepEqual(
      resolvePeopleOffboardingProjection(
        '/assignments',
        'POST',
        {
          assignment_code: 'ASN-003',
          employee_uid: 'u002',
          change_type: 'leave',
          effective_from: '2026-06-30',
          operator_uid: 'approver-3'
        }
      ),
      {
        employeeUid: 'u002',
        operatorUid: 'approver-3',
        leaveDate: '2026-06-30',
        reason: 'people_assignment_leave_offboarding'
      }
    )
  })

  test('rejected callback never projects lifecycle changes', () => {
    const content = source('server/utils/peopleWorkflowCallbackProjection.ts')

    assert.match(content, /callback\.status !== 'approved'/)
    assert.match(content, /return \{ employment: null, offboarding: null \}/)
  })

  test('workflow callback authenticates before body access and forwards only normalized data to the fixed runtime hook', () => {
    const content = source('server/api/v1/service/workflow/callback.post.ts')

    const authorization = 'await requireServiceScope(event, { scope: \'workflow:callback\', allowedApps: [\'workflow\'] })'
    assertBefore(content, authorization, 'await readBody<Record<string, unknown>>(event)')
    assertBefore(content, 'normalizePeopleWorkflowCallbackBody(rawBody)', 'callPeopleWorkflowCallbackRuntime(event, callback.body)')
    assert.match(content, /maybeCallTenantRuntime<RuntimeEnvelope<RuntimeObject>>\([\s\S]{0,120}'\/v1\/people\/service\/workflow\/callback'/)
    assert.doesNotMatch(content, /current_user_data_access|currentUserDataAccess|current_user\s*:|operator_uid\s*:/)
    assert.doesNotMatch(content, /consoleDirectoryProjection|projectConsoleDirectory|disableConsoleDirectory|\$fetch[^\n]*console/)
    assert.match(content, /if \(delivery\?\.pending\) setResponseStatus\(event, 202\)/)
  })

  test('tenant-runtime middleware leaves workflow callback to the local BFF route', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /service\\\/workflow\\\/callback/)
    assertBefore(content, 'if (isAllowedLocalApiV1Path(pathname)) return', 'maybeProxyCurrentApiToTenantRuntime(event')
    assert.match(content, /\^\\\/api\\\/v1\\\/service\\\/workflow\\\/callback\$/)
  })
})
