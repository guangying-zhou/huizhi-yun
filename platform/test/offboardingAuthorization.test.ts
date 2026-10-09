import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import {
  revokeUserAuthorizationForOffboarding,
  type OffboardingAuthorizationExecutor
} from '../server/utils/offboardingAuthorization.ts'

const tenantCode = 'C000001'
const uid = 'u001'

function result(affectedRows: number) {
  return { affectedRows } as ResultSetHeader
}

function executorWithSubject(subject: RowDataPacket | null) {
  const statements: Array<{ sql: string, params: unknown[] }> = []
  const executor: OffboardingAuthorizationExecutor = {
    queryRow: async <T extends RowDataPacket>(sql: string): Promise<T | null> => {
      assert.match(sql, /FROM tenant_subjects/)
      assert.match(sql, /subject_type = 'user'/)
      assert.match(sql, /subject_code = \? OR external_ref = \?/)
      return subject as T | null
    },
    execute: async <T extends ResultSetHeader>(sql: string, params: unknown[] = []): Promise<T> => {
      statements.push({ sql, params })
      if (sql.includes('tenant_subject_role_scopes')) return result(2) as T
      if (sql.includes('tenant_subject_roles')) return result(3) as T
      if (sql.includes('tenant_template_bindings')) return result(1) as T
      if (sql.includes('tenant_template_overrides')) return result(1) as T
      if (sql.includes('tenant_subject_memberships')) return result(2) as T
      if (sql.includes('tenant_subjects')) return result(1) as T
      if (sql.includes('tenant_audit_logs')) return result(1) as T
      throw new Error(`Unexpected SQL: ${sql}`)
    }
  }

  return { executor, statements }
}

describe('revokeUserAuthorizationForOffboarding', () => {
  test('disables user subject and revokes direct authorization sources', async () => {
    const { executor, statements } = executorWithSubject({
      id: 101,
      tenant_code: tenantCode,
      subject_type: 'user',
      subject_code: uid,
      external_ref: uid,
      status: 'active'
    } as RowDataPacket)

    const revoked = await revokeUserAuthorizationForOffboarding(executor, {
      tenantCode,
      uid,
      sourceApp: 'people',
      operatorUid: 'hr001',
      reason: 'people_assignment_leave_offboarding',
      idempotencyKey: 'idem-001'
    })

    assert.deepEqual(revoked, {
      tenantCode,
      uid,
      subjectFound: true,
      subjectId: 101,
      previousSubjectStatus: 'active',
      subjectDisabled: true,
      revokedAssignments: 3,
      disabledAssignmentScopes: 2,
      disabledTemplateBindings: 1,
      disabledTemplateOverrides: 1,
      inactiveMemberships: 2,
      idempotencyKey: 'idem-001'
    })

    const sql = statements.map(item => item.sql).join('\n')
    assert.match(sql, /UPDATE tenant_subject_role_scopes/)
    assert.match(sql, /UPDATE tenant_subject_roles\s+SET status = 'revoked'/)
    assert.match(sql, /UPDATE tenant_template_bindings\s+SET status = 'disabled'/)
    assert.match(sql, /UPDATE tenant_template_overrides\s+SET status = 'disabled'/)
    assert.match(sql, /UPDATE tenant_subject_memberships\s+SET status = 'inactive'/)
    assert.match(sql, /UPDATE tenant_subjects\s+SET status = 'disabled'/)
    assert.match(sql, /INSERT INTO tenant_audit_logs/)
  })

  test('is idempotent when the Platform user subject is missing', async () => {
    const { executor, statements } = executorWithSubject(null)

    const revoked = await revokeUserAuthorizationForOffboarding(executor, {
      tenantCode,
      uid,
      sourceApp: 'people'
    })

    assert.equal(revoked.subjectFound, false)
    assert.equal(revoked.subjectDisabled, false)
    assert.equal(revoked.revokedAssignments, 0)
    assert.equal(statements.length, 1)
    assert.match(statements[0]?.sql || '', /INSERT INTO tenant_audit_logs/)
  })

  test('rejects non-People lifecycle sources', async () => {
    const { executor } = executorWithSubject(null)

    await assert.rejects(
      () => revokeUserAuthorizationForOffboarding(executor, {
        tenantCode,
        uid,
        sourceApp: 'console'
      }),
      /Only People lifecycle facts/
    )
  })
})
