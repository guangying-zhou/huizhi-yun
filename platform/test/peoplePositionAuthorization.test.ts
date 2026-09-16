import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  syncPeoplePositionAuthorization,
  type PeoplePositionAuthorizationExecutor
} from '../server/utils/peoplePositionAuthorization.ts'

const tenantCode = 'C000001'
const uid = 'u001'

function result(affectedRows: number, insertId = 0) {
  return { affectedRows, insertId } as ResultSetHeader
}

function executorWith(input: {
  subject?: RowDataPacket | null
  roles?: RowDataPacket[]
  assignmentId?: number
  revokedRows?: number
}) {
  const statements: Array<{ sql: string, params: unknown[] }> = []
  const executor: PeoplePositionAuthorizationExecutor = {
    queryRow: async <T extends RowDataPacket>(sql: string): Promise<T | null> => {
      if (sql.includes('FROM tenant_subjects')) {
        return (input.subject ?? null) as T | null
      }
      if (sql.includes('FROM tenant_subject_roles')) {
        return { id: input.assignmentId || 0 } as T
      }
      throw new Error(`Unexpected queryRow SQL: ${sql}`)
    },
    queryRows: async <T extends RowDataPacket[]>(sql: string): Promise<T> => {
      if (sql.includes('FROM tenant_roles')) {
        return (input.roles || []) as T
      }
      throw new Error(`Unexpected queryRows SQL: ${sql}`)
    },
    execute: async <T extends ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> => {
      statements.push({ sql, params })
      if (sql.includes('INSERT INTO tenant_subjects')) return result(1, 101) as T
      if (sql.includes('UPDATE tenant_subjects')) return result(1) as T
      if (sql.includes('UPDATE tenant_subject_roles')) return result(input.revokedRows ?? 0) as T
      if (sql.includes('INSERT INTO tenant_subject_roles')) return result(1) as T
      if (sql.includes('INSERT INTO tenant_audit_logs')) return result(1) as T
      throw new Error(`Unexpected execute SQL: ${sql}`)
    }
  }

  return { executor, statements }
}

describe('syncPeoplePositionAuthorization', () => {
  test('grants the matching main position role and revokes stale People position grants', async () => {
    const { executor, statements } = executorWith({
      subject: {
        id: 11,
        tenant_code: tenantCode,
        subject_type: 'user',
        subject_code: uid,
        external_ref: uid,
        status: 'active'
      } as RowDataPacket,
      roles: [
        {
          id: 301,
          tenant_code: tenantCode,
          role_code: 'delivery_pm',
          role_name: '交付项目经理',
          description: '交付项目主岗位',
          source: 'custom',
          source_role_code: null,
          catalog_category: 'main_position'
        } as RowDataPacket
      ],
      assignmentId: 901,
      revokedRows: 2
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'delivery_pm',
      positionName: '交付项目经理',
      operatorUid: 'hr001',
      reason: 'people_assignment_membership_projection',
      idempotencyKey: 'idem-001'
    })

    assert.equal(synced.roleMatched, true)
    assert.equal(synced.role?.roleCode, 'delivery_pm')
    assert.equal(synced.role?.catalogCategory, 'main_position')
    assert.equal(synced.sourceId, 'people:position:delivery_pm')
    assert.equal(synced.grantedAssignmentId, 901)
    assert.equal(synced.revokedPositionAssignments, 2)

    const sql = statements.map(item => item.sql).join('\n')
    assert.match(sql, /UPDATE tenant_subject_roles/)
    assert.match(sql, /AND NOT \(role_id = \? AND source_id = \?\)/)
    assert.match(sql, /INSERT INTO tenant_subject_roles/)
    assert.match(sql, /'system', 'position'/)
    assert.match(sql, /INSERT INTO tenant_audit_logs/)
  })

  test('creates a missing user subject and only revokes stale grants when no main role matches', async () => {
    const { executor, statements } = executorWith({
      subject: null,
      roles: [],
      revokedRows: 1
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'unknown_position',
      positionName: '未知岗位'
    })

    assert.equal(synced.subjectCreated, true)
    assert.equal(synced.subjectId, 101)
    assert.equal(synced.roleMatched, false)
    assert.equal(synced.grantedAssignmentId, 0)
    assert.equal(synced.revokedPositionAssignments, 1)

    const sql = statements.map(item => item.sql).join('\n')
    assert.match(sql, /INSERT INTO tenant_subjects/)
    assert.match(sql, /display_name, external_ref, status/)
    assert.doesNotMatch(sql, /INSERT INTO tenant_subject_roles/)
    assert.match(sql, /INSERT INTO tenant_audit_logs/)
  })

  test('never auto-grants a high risk role even when the position code matches exactly', async () => {
    const { executor, statements } = executorWith({
      subject: {
        id: 11,
        tenant_code: tenantCode,
        subject_type: 'user',
        subject_code: uid,
        external_ref: uid,
        status: 'active'
      } as RowDataPacket,
      roles: [
        {
          id: 401,
          tenant_code: tenantCode,
          role_code: 'security_admin',
          role_name: '安全管理员',
          description: '安全与发布高权限',
          source: 'custom',
          source_role_code: null,
          catalog_category: null
        } as RowDataPacket
      ]
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'security_admin',
      positionName: '安全管理员'
    })

    assert.equal(synced.roleMatched, false)
    assert.equal(synced.grantedAssignmentId, 0)
    assert.equal(synced.candidateCount, 1)
    assert.deepEqual(synced.excludedCandidates?.map(item => [item.roleCode, item.category, item.exactCodeMatch]), [
      ['security_admin', 'high_risk_privilege', true]
    ])

    const sql = statements.map(item => item.sql).join('\n')
    assert.doesNotMatch(sql, /INSERT INTO tenant_subject_roles/)
  })

  test('keeps granting unclassified ordinary position roles so the gate does not stop normal onboarding', async () => {
    const { executor } = executorWith({
      subject: {
        id: 11,
        tenant_code: tenantCode,
        subject_type: 'user',
        subject_code: uid,
        external_ref: uid,
        status: 'active'
      } as RowDataPacket,
      roles: [
        {
          id: 402,
          tenant_code: tenantCode,
          role_code: 'java_engineer',
          role_name: 'Java 工程师',
          description: '研发岗位',
          source: 'system',
          source_role_code: null,
          catalog_category: null
        } as RowDataPacket
      ],
      assignmentId: 902
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'java_engineer',
      positionName: 'Java 工程师'
    })

    assert.equal(synced.roleMatched, true)
    assert.equal(synced.role?.catalogCategory, 'main_position')
    assert.equal(synced.role?.catalogCategorySource, 'derived')
    assert.equal(synced.grantedAssignmentId, 902)
    assert.deepEqual(synced.excludedCandidates, [])
  })

  test('lets an explicit main position classification override the sensitive keyword heuristic', async () => {
    const { executor } = executorWith({
      subject: {
        id: 11,
        tenant_code: tenantCode,
        subject_type: 'user',
        subject_code: uid,
        external_ref: uid,
        status: 'active'
      } as RowDataPacket,
      roles: [
        {
          id: 403,
          tenant_code: tenantCode,
          role_code: 'delivery_manager',
          role_name: '交付经理',
          description: '交付主岗位',
          source: 'custom',
          source_role_code: null,
          catalog_category: 'main_position'
        } as RowDataPacket
      ],
      assignmentId: 903
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'delivery_manager',
      positionName: '交付经理'
    })

    assert.equal(synced.roleMatched, true)
    assert.equal(synced.role?.catalogCategorySource, 'manual')
    assert.equal(synced.grantedAssignmentId, 903)
  })

  test('does not auto-grant a management duty role matched only by role name text', async () => {
    const { executor, statements } = executorWith({
      subject: {
        id: 11,
        tenant_code: tenantCode,
        subject_type: 'user',
        subject_code: uid,
        external_ref: uid,
        status: 'active'
      } as RowDataPacket,
      roles: [
        {
          id: 404,
          tenant_code: tenantCode,
          role_code: 'sales_director_role',
          role_name: '销售总监',
          description: '销售管理职责',
          source: 'custom',
          source_role_code: null,
          catalog_category: null
        } as RowDataPacket
      ]
    })

    const synced = await syncPeoplePositionAuthorization(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      positionCode: 'sales_head',
      positionName: '销售总监'
    })

    assert.equal(synced.roleMatched, false)
    assert.deepEqual(synced.excludedCandidates?.map(item => [item.category, item.exactCodeMatch, item.exactNameMatch]), [
      ['management_duty', false, true]
    ])

    const sql = statements.map(item => item.sql).join('\n')
    assert.doesNotMatch(sql, /INSERT INTO tenant_subject_roles/)
  })

  test('rejects non-People lifecycle sources', async () => {
    const { executor } = executorWith({ subject: null })

    await assert.rejects(
      () => syncPeoplePositionAuthorization(executor, {
        tenantCode,
        uid,
        sourceApp: 'console',
        positionCode: 'delivery_pm'
      }),
      /Only People lifecycle facts/
    )
  })
})
