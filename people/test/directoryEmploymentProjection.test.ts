import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePeopleDirectoryEmploymentProjection } from '../server/utils/peopleDirectoryProjection.ts'

describe('resolvePeopleDirectoryEmploymentProjection', () => {
  test('employee create or update projects active employment fields', () => {
    assert.deepEqual(
      resolvePeopleDirectoryEmploymentProjection('/employees', 'POST', {
        employee_uid: 'u001',
        login_name: 'zhangsan',
        display_name: '张三',
        dept_code: 'dept-sales',
        position_code: 'sales_manager',
        position_name: '销售经理',
        employment_status: 'active',
        current_user: 'hr-admin'
      }),
      {
        employeeUid: 'u001',
        loginName: 'zhangsan',
        displayName: '张三',
        realName: '张三',
        deptCode: 'dept-sales',
        positionCode: 'sales_manager',
        positionName: '销售经理',
        employmentStatus: 'active',
        operatorUid: 'hr-admin',
        reason: 'people_employee_fact_projection'
      }
    )

    assert.deepEqual(
      resolvePeopleDirectoryEmploymentProjection('/employees/u%3A002', 'PATCH', {
        dept_code: 'dept-rd',
        position_name: '研发负责人'
      }),
      {
        employeeUid: 'u:002',
        loginName: '',
        displayName: '',
        realName: '',
        deptCode: 'dept-rd',
        positionCode: '',
        positionName: '研发负责人',
        employmentStatus: '',
        operatorUid: '',
        reason: 'people_employee_fact_projection'
      }
    )
  })

  test('non-leave assignments project department and position membership', () => {
    assert.deepEqual(
      resolvePeopleDirectoryEmploymentProjection('/assignments', 'POST', {
        employee_uid: 'u001',
        change_type: 'transfer',
        dept_code: 'dept-delivery',
        position_code: 'delivery_pm',
        position_name: '交付经理',
        operator_uid: 'manager-1'
      }),
      {
        employeeUid: 'u001',
        loginName: '',
        displayName: '',
        realName: '',
        deptCode: 'dept-delivery',
        positionCode: 'delivery_pm',
        positionName: '交付经理',
        employmentStatus: 'active',
        operatorUid: 'manager-1',
        reason: 'people_assignment_membership_projection'
      }
    )
  })

  test('offboarding and unrelated writes do not project active employment', () => {
    assert.equal(
      resolvePeopleDirectoryEmploymentProjection('/employees/u001', 'PATCH', { employment_status: 'left' }),
      null
    )
    assert.equal(
      resolvePeopleDirectoryEmploymentProjection('/assignments', 'POST', { employee_uid: 'u001', change_type: 'leave', dept_code: 'dept-sales' }),
      null
    )
    assert.equal(
      resolvePeopleDirectoryEmploymentProjection('/assignments', 'POST', { employee_uid: 'u001', change_type: 'rank_change' }),
      null
    )
    assert.equal(
      resolvePeopleDirectoryEmploymentProjection('/employees/u001', 'PATCH', { monthly_standard_cost: 12000 }),
      null
    )
  })
})
