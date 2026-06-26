import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RowDataPacket } from 'mysql2/promise'
import {
  evaluateStaticRoleConflicts,
  evaluateSubjectRoleAssignmentConflictsWithQueries,
  type StaticRoleConflictRule
} from '../server/utils/staticRoleConflicts.ts'

describe('static role conflict rules', () => {
  test('finance expense edit plus confirm triggers a warning conflict', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'finance_maker',
        roleName: '付款制单',
        permissions: [{ appCode: 'finance', resourceCode: 'expenses', action: 'edit' }]
      },
      {
        roleId: 2,
        roleCode: 'finance_confirmer',
        roleName: '付款确认',
        permissions: [{ appCode: 'finance', resourceCode: 'expenses', action: 'confirm' }]
      }
    ])

    assert.equal(evaluation.warnings.length, 1)
    assert.equal(evaluation.blockingConflicts.length, 0)
    assert.equal(evaluation.warnings[0].ruleCode, 'finance-expense-maker-confirmation')
  })

  test('admin does not imply sensitive confirm side of a conflict', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'finance_admin',
        roleName: '财务管理员',
        permissions: [{ appCode: 'finance', resourceCode: 'expenses', action: 'admin' }]
      },
      {
        roleId: 2,
        roleCode: 'finance_editor',
        roleName: '费用维护',
        permissions: [{ appCode: 'finance', resourceCode: 'expenses', action: 'edit' }]
      }
    ])

    assert.equal(evaluation.conflicts.length, 0)
  })

  test('custom enforce rules are returned as blocking conflicts', () => {
    const rules: StaticRoleConflictRule[] = [{
      ruleCode: 'webdev-execute-deploy-enforce',
      ruleName: '开发执行与部署硬隔离',
      conflictType: 'segregation_of_duties',
      enforcement: 'enforce',
      left: { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'execute' },
      right: { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'deploy' },
      description: '测试用硬阻断规则'
    }]
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'developer',
        roleName: '开发',
        permissions: [{ appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'execute' }]
      },
      {
        roleId: 2,
        roleCode: 'deployer',
        roleName: '部署',
        permissions: [{ appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'deploy' }]
      }
    ], rules)

    assert.equal(evaluation.blockingConflicts.length, 1)
    assert.equal(evaluation.blockingConflicts[0].enforcement, 'enforce')
  })

  test('subject assignment conflict loader evaluates existing role plus candidate role', async () => {
    const queries = {
      async queryRows<T extends RowDataPacket[]>(sql: string): Promise<T> {
        if (sql.includes('FROM tenant_role_conflict_rules')) {
          return [] as unknown as T
        }
        if (sql.includes('FROM tenant_subject_roles tsr')) {
          return [{
            role_id: 1,
            role_code: 'finance_maker',
            role_name: '付款制单'
          }] as unknown as T
        }
        if (sql.includes('FROM tenant_role_permissions')) {
          return [
            {
              role_id: 1,
              app_code: 'finance',
              resource_code: 'expenses',
              action: 'edit'
            },
            {
              role_id: 2,
              app_code: 'finance',
              resource_code: 'expenses',
              action: 'confirm'
            }
          ] as unknown as T
        }
        return [] as unknown as T
      }
    }

    const evaluation = await evaluateSubjectRoleAssignmentConflictsWithQueries(queries, {
      tenantCode: 't1',
      subjectId: 10,
      candidateRole: {
        roleId: 2,
        roleCode: 'finance_confirmer',
        roleName: '付款确认'
      }
    })

    assert.equal(evaluation.warnings.length, 1)
    assert.match(evaluation.warnings[0].message, /付款制单/)
    assert.match(evaluation.warnings[0].message, /付款确认/)
  })

  test('tenant table rules are merged into subject assignment evaluation', async () => {
    const queries = {
      async queryRows<T extends RowDataPacket[]>(sql: string): Promise<T> {
        if (sql.includes('FROM tenant_role_conflict_rules')) {
          return [{
            rule_code: 'tenant-webdev-release-enforce',
            rule_name: '生产发布硬隔离',
            conflict_type: 'segregation_of_duties',
            enforcement: 'enforce',
            left_role_code: null,
            right_role_code: null,
            left_app_code: 'webdev',
            left_resource_code: 'webdev_workspace',
            left_action: 'execute',
            right_app_code: 'webdev',
            right_resource_code: 'webdev_workspace',
            right_action: 'deploy',
            description: '租户要求执行人与部署人硬隔离'
          }] as unknown as T
        }
        if (sql.includes('FROM tenant_subject_roles tsr')) {
          return [{
            role_id: 1,
            role_code: 'developer',
            role_name: '开发执行'
          }] as unknown as T
        }
        if (sql.includes('FROM tenant_role_permissions')) {
          return [
            {
              role_id: 1,
              app_code: 'webdev',
              resource_code: 'webdev_workspace',
              action: 'execute'
            },
            {
              role_id: 2,
              app_code: 'webdev',
              resource_code: 'webdev_workspace',
              action: 'deploy'
            }
          ] as unknown as T
        }
        return [] as unknown as T
      }
    }

    const evaluation = await evaluateSubjectRoleAssignmentConflictsWithQueries(queries, {
      tenantCode: 't1',
      subjectId: 10,
      candidateRole: {
        roleId: 2,
        roleCode: 'deployer',
        roleName: '生产部署'
      }
    })

    assert.equal(evaluation.blockingConflicts.length, 1)
    assert.equal(evaluation.blockingConflicts[0].ruleCode, 'tenant-webdev-release-enforce')
  })
})
