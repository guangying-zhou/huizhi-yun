import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePeopleOffboardingProjection } from '../server/utils/peopleOffboardingProjection.ts'

describe('resolvePeopleOffboardingProjection', () => {
  test('employee left or inactive status writes project to Console directory disable', () => {
    assert.deepEqual(
      resolvePeopleOffboardingProjection('/employees/u%3A001', 'PATCH', {
        employment_status: 'left',
        leave_date: '2026-06-29',
        current_user: 'hr-admin'
      }),
      {
        employeeUid: 'u:001',
        operatorUid: 'hr-admin',
        leaveDate: '2026-06-29',
        reason: 'people_employee_status_offboarding'
      }
    )

    assert.equal(
      resolvePeopleOffboardingProjection('/employees/u001', 'PATCH', { employment_status: 'active' }),
      null
    )
  })

  test('assignment leave writes project to Console directory disable', () => {
    assert.deepEqual(
      resolvePeopleOffboardingProjection('/assignments', 'POST', {
        employee_uid: 'u001',
        change_type: 'leave',
        effective_from: '2026-06-30',
        operator_uid: 'manager-1'
      }),
      {
        employeeUid: 'u001',
        operatorUid: 'manager-1',
        leaveDate: '2026-06-30',
        reason: 'people_assignment_leave_offboarding'
      }
    )
  })

  test('non-mutating requests and incomplete leave assignments do not project', () => {
    assert.equal(
      resolvePeopleOffboardingProjection('/employees/u001', 'GET', { employment_status: 'left' }),
      null
    )
    assert.equal(
      resolvePeopleOffboardingProjection('/assignments', 'POST', { change_type: 'leave' }),
      null
    )
    assert.equal(
      resolvePeopleOffboardingProjection('/assignments', 'POST', { employee_uid: 'u001', change_type: 'rank_change' }),
      null
    )
  })
})
