import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import type { RowDataPacket } from 'mysql2/promise'
import {
  evaluateStaticRoleConflicts,
  evaluateSubjectRoleAssignmentConflictsWithQueries,
  STATIC_ROLE_CONFLICT_RULES,
  type StaticRoleConflictRule
} from '../server/utils/staticRoleConflicts.ts'

type ManifestAction = string | {
  action?: string
}

type ManifestResource = {
  code?: string
  actions?: ManifestAction[]
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function manifestResourceActions(appCode: string) {
  const manifest = JSON.parse(workspaceSource(`${appCode}/app.manifest.json`)) as { resources?: ManifestResource[] }
  return new Map((manifest.resources || [])
    .filter(resource => resource.code)
    .map(resource => [
      resource.code!,
      new Set((resource.actions || [])
        .map(action => typeof action === 'string' ? action : action.action)
        .filter((action): action is string => typeof action === 'string' && action.length > 0))
    ]))
}

describe('static role conflict rules', () => {
  test('built-in conflict rules reference manifest declared resource actions', () => {
    const actionsByApp = new Map<string, Map<string, Set<string>>>()
    const missing = STATIC_ROLE_CONFLICT_RULES.flatMap((rule) => {
      return [rule.left, rule.right].flatMap((permission) => {
        if (!permission) {
          return []
        }

        if (!actionsByApp.has(permission.appCode)) {
          actionsByApp.set(permission.appCode, manifestResourceActions(permission.appCode))
        }

        const actionsByResource = actionsByApp.get(permission.appCode)!
        const actions = actionsByResource.get(permission.resourceCode)
        const label = `${rule.ruleCode}|${permission.appCode}:${permission.resourceCode}:${permission.action}`

        if (!actions) {
          return [`${label}|missing resource`]
        }
        if (!actions.has(permission.action)) {
          return [`${label}|missing action`]
        }

        return []
      })
    }).sort()

    assert.deepEqual(missing, [])
  })

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

  test('codocs review submit plus approve and archive trigger warning conflicts', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'codocs_editor',
        roleName: '文档提交',
        permissions: [{ appCode: 'codocs', resourceCode: 'reviews', action: 'submit' }]
      },
      {
        roleId: 2,
        roleCode: 'codocs_publisher',
        roleName: '文档发布',
        permissions: [
          { appCode: 'codocs', resourceCode: 'reviews', action: 'approve' },
          { appCode: 'codocs', resourceCode: 'reviews', action: 'archive' }
        ]
      }
    ])

    assert.deepEqual(
      evaluation.warnings.map(item => item.ruleCode).sort(),
      ['codocs-review-submit-approval', 'codocs-review-submit-archive']
    )
  })

  test('altoc quotation contract and receivable duties trigger warning conflicts', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'altoc_operator',
        roleName: '经营经办',
        permissions: [
          { appCode: 'altoc', resourceCode: 'quotation', action: 'edit' },
          { appCode: 'altoc', resourceCode: 'contract', action: 'edit' },
          { appCode: 'altoc', resourceCode: 'receivable', action: 'edit' }
        ]
      },
      {
        roleId: 2,
        roleCode: 'altoc_approver',
        roleName: '经营审批确认',
        permissions: [
          { appCode: 'altoc', resourceCode: 'quotation', action: 'approve' },
          { appCode: 'altoc', resourceCode: 'contract', action: 'approve' },
          { appCode: 'altoc', resourceCode: 'receivable', action: 'confirm' }
        ]
      }
    ])

    assert.deepEqual(
      evaluation.warnings.map(item => item.ruleCode).sort(),
      [
        'altoc-contract-operator-approval',
        'altoc-quotation-operator-approval',
        'altoc-receivable-operator-confirmation'
      ]
    )
  })

  test('aims project work item and timesheet duties trigger warning conflicts', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'aims_operator',
        roleName: '研发经办',
        permissions: [
          { appCode: 'aims', resourceCode: 'projects', action: 'edit' },
          { appCode: 'aims', resourceCode: 'work_items', action: 'edit' },
          { appCode: 'aims', resourceCode: 'timesheet', action: 'submit' }
        ]
      },
      {
        roleId: 2,
        roleCode: 'aims_reviewer',
        roleName: '研发审批确认',
        permissions: [
          { appCode: 'aims', resourceCode: 'projects', action: 'approve' },
          { appCode: 'aims', resourceCode: 'work_items', action: 'confirm' },
          { appCode: 'aims', resourceCode: 'timesheet', action: 'approve' }
        ]
      }
    ])

    assert.deepEqual(
      evaluation.warnings.map(item => item.ruleCode).sort(),
      [
        'aims-project-operator-approval',
        'aims-timesheet-submit-approval',
        'aims-work-item-operator-confirmation'
      ]
    )
  })

  test('workflow initiator plus task approver triggers a warning conflict', () => {
    const evaluation = evaluateStaticRoleConflicts([
      {
        roleId: 1,
        roleCode: 'workflow_initiator',
        roleName: '流程发起',
        permissions: [{ appCode: 'workflow', resourceCode: 'workflow_instances', action: 'resubmit' }]
      },
      {
        roleId: 2,
        roleCode: 'workflow_approver',
        roleName: '流程审批',
        permissions: [{ appCode: 'workflow', resourceCode: 'workflow_tasks', action: 'approve' }]
      }
    ])

    assert.equal(evaluation.warnings.length, 1)
    assert.equal(evaluation.warnings[0].ruleCode, 'workflow-initiator-task-approval')
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
