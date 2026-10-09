import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RowDataPacket } from 'mysql2/promise'
import {
  explainInstanceConflictsWithQueries,
  type InstanceConflictExplainInput
} from '../server/utils/instanceConflictExplanation.ts'
import type { AuthorizationGrantQueryAdapter } from '../server/utils/authorizationGrants.ts'

const tenantCode = 'tenant-demo'
const uid = 'user-1'
const subject = {
  id: 101,
  tenant_code: tenantCode,
  subject_type: 'user',
  subject_code: uid,
  display_name: '测试用户',
  external_ref: uid
}

const roles = [
  {
    assignment_id: 1001,
    subject_id: subject.id,
    role_id: 201,
    role_code: 'finance_maker',
    role_name: '付款制单',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'maker',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  },
  {
    assignment_id: 1002,
    subject_id: subject.id,
    role_id: 202,
    role_code: 'finance_confirmer',
    role_name: '付款确认',
    role_type: 'custom',
    app_code: null,
    source_type: 'manual',
    source_id: 'confirmer',
    assignment_kind: 'duty',
    starts_at: null,
    expired_at: null
  }
]

const permissions = [
  {
    role_id: 201,
    app_code: 'finance',
    resource_code: 'expenses',
    action: 'edit'
  },
  {
    role_id: 202,
    app_code: 'finance',
    resource_code: 'expenses',
    action: 'confirm'
  }
]

function selectedNumbers(params: unknown[]) {
  return new Set(params.filter((value): value is number => typeof value === 'number'))
}

function createQueries(options: {
  roleIds?: number[]
  tenantEnforceRule?: boolean
  roles?: typeof roles
  permissions?: typeof permissions
} = {}): AuthorizationGrantQueryAdapter {
  const queryRoles = options.roles || roles
  const queryPermissions = options.permissions || permissions
  const allowedRoleIds = new Set(options.roleIds || queryRoles.map(role => role.role_id))
  return {
    queryRow: async <T extends RowDataPacket>(sql: string): Promise<T | null> => {
      if (sql.includes('FROM tenant_subjects')) {
        return subject as unknown as T
      }
      throw new Error(`Unexpected queryRow SQL: ${sql}`)
    },
    queryRows: async <T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> => {
      if (sql.includes('FROM tenant_role_conflict_rules')) {
        if (!options.tenantEnforceRule) return [] as unknown as T
        return [{
          rule_code: 'tenant-finance-expense-maker-confirmation',
          rule_name: '租户付款制单与确认硬隔离',
          conflict_type: 'segregation_of_duties',
          enforcement: 'enforce',
          left_role_code: null,
          right_role_code: null,
          left_app_code: 'finance',
          left_resource_code: 'expenses',
          left_action: 'edit',
          right_app_code: 'finance',
          right_resource_code: 'expenses',
          right_action: 'confirm',
          description: '租户要求付款制单人与确认人必须不同'
        }] as unknown as T
      }
      if (sql.includes('FROM tenant_subject_memberships')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_subject_roles tsr')) {
        return queryRoles.filter(role => allowedRoleIds.has(role.role_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_template_bindings')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_template_overrides')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_role_permissions')) {
        const selected = selectedNumbers(params)
        return queryPermissions
          .filter(permission => selected.has(permission.role_id))
          .filter(permission => allowedRoleIds.has(permission.role_id)) as unknown as T
      }
      if (sql.includes('FROM tenant_role_scopes')) {
        return [] as unknown as T
      }
      if (sql.includes('FROM tenant_subject_role_scopes')) {
        return [] as unknown as T
      }
      throw new Error(`Unexpected queryRows SQL: ${sql}`)
    }
  }
}

function baseInput(overrides: Partial<InstanceConflictExplainInput> = {}): InstanceConflictExplainInput {
  return {
    tenantCode,
    uid,
    appCode: 'finance',
    resourceCode: 'expenses',
    action: 'confirm',
    object: { actorUid: uid },
    principals: [{ kind: 'applicant', uid }],
    ...overrides
  }
}

describe('explainInstanceConflictsWithQueries', () => {
  test('explains self confirmation when the actor is also the applicant', async () => {
    const result = await explainInstanceConflictsWithQueries(createQueries(), baseInput())

    assert.equal(result.hasViolation, true)
    assert.equal(result.hasWarningViolation, true)
    assert.equal(result.hasBlockingViolation, false)
    assert.equal(result.rules[0].ruleCode, 'finance-expense-maker-confirmation')
    assert.equal(result.rules[0].status, 'violated')
    assert.equal(result.rules[0].reasonCode, 'self_approval')
    assert.equal(result.rules[0].requested.allowed, true)
    assert.equal(result.rules[0].counterpart.allowed, true)
    assert.deepEqual(result.rules[0].sameActorPrincipals.map(item => item.kind), ['applicant'])
  })

  test('reports satisfied when the applicant is a different user', async () => {
    const result = await explainInstanceConflictsWithQueries(
      createQueries(),
      baseInput({ principals: [{ kind: 'applicant', uid: 'user-2' }] })
    )

    assert.equal(result.hasViolation, false)
    assert.equal(result.rules[0].status, 'satisfied')
    assert.equal(result.rules[0].reasonCode, 'different_instance_actor')
  })

  test('does not mark a violation when the actor lacks the counterpart duty', async () => {
    const result = await explainInstanceConflictsWithQueries(
      createQueries({ roleIds: [202] }),
      baseInput()
    )

    assert.equal(result.hasViolation, false)
    assert.equal(result.rules[0].status, 'not_applicable')
    assert.equal(result.rules[0].reasonCode, 'missing_counterpart_permission')
    assert.equal(result.rules[0].requested.allowed, true)
    assert.equal(result.rules[0].counterpart.allowed, false)
  })

  test('tenant enforce rules become blocking instance violations', async () => {
    const result = await explainInstanceConflictsWithQueries(
      createQueries({ tenantEnforceRule: true }),
      baseInput()
    )

    const tenantRule = result.rules.find(rule => rule.ruleCode === 'tenant-finance-expense-maker-confirmation')
    assert.ok(tenantRule)
    assert.equal(tenantRule.status, 'violated')
    assert.equal(tenantRule.enforcement, 'enforce')
    assert.equal(result.hasBlockingViolation, true)
  })

  test('treats archive as approval-like for Codocs publish archiving', async () => {
    const result = await explainInstanceConflictsWithQueries(
      createQueries({
        roles: [
          {
            assignment_id: 2001,
            subject_id: subject.id,
            role_id: 301,
            role_code: 'codocs_submitter',
            role_name: '文档发起',
            role_type: 'custom',
            app_code: null,
            source_type: 'manual',
            source_id: 'submitter',
            assignment_kind: 'duty',
            starts_at: null,
            expired_at: null
          },
          {
            assignment_id: 2002,
            subject_id: subject.id,
            role_id: 302,
            role_code: 'codocs_archiver',
            role_name: '发布归档',
            role_type: 'custom',
            app_code: null,
            source_type: 'manual',
            source_id: 'archiver',
            assignment_kind: 'duty',
            starts_at: null,
            expired_at: null
          }
        ],
        permissions: [
          {
            role_id: 301,
            app_code: 'codocs',
            resource_code: 'reviews',
            action: 'submit'
          },
          {
            role_id: 302,
            app_code: 'codocs',
            resource_code: 'reviews',
            action: 'archive'
          }
        ]
      }),
      baseInput({
        appCode: 'codocs',
        resourceCode: 'reviews',
        action: 'archive',
        principals: [{ kind: 'initiator', uid }]
      })
    )

    const archiveRule = result.rules.find(rule => rule.ruleCode === 'codocs-review-submit-archive')
    assert.ok(archiveRule)
    assert.equal(archiveRule.status, 'violated')
    assert.equal(archiveRule.reasonCode, 'self_approval')
    assert.equal(result.hasWarningViolation, true)
  })
})
