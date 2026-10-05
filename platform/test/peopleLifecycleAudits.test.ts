import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RowDataPacket } from 'mysql2/promise'
import {
  listPeopleLifecycleAudits,
  type PeopleLifecycleAuditExecutor
} from '../server/utils/peopleLifecycleAudits.ts'

function executorWithRows(rows: RowDataPacket[]) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const executor: PeopleLifecycleAuditExecutor = {
    queryRows: async <T extends RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> => {
      queries.push({ sql, params })
      assert.match(sql, /FROM tenant_audit_logs/)
      return rows as T
    },
    queryRow: async <T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> => {
      queries.push({ sql, params })
      assert.match(sql, /COUNT\(\*\) AS total/)
      return { total: rows.length } as T
    }
  }

  return { executor, queries }
}

describe('listPeopleLifecycleAudits', () => {
  test('lists People position sync and offboarding audit records with normalized status', async () => {
    const { executor, queries } = executorWithRows([
      {
        id: 1,
        tenant_code: 'C000001',
        operator_uid: 'hr001',
        action: 'authorization.user.position.sync.from_people',
        target_type: 'user',
        target_id: 'u001',
        source: 'people',
        before_json: JSON.stringify({ positionCode: 'delivery_pm' }),
        after_json: JSON.stringify({ roleMatched: true, role: { roleCode: 'delivery_pm' } }),
        created_at: '2026-06-29 10:00:00'
      } as RowDataPacket,
      {
        id: 2,
        tenant_code: 'C000001',
        operator_uid: 'hr002',
        action: 'authorization.user.offboard.from_people',
        target_type: 'user',
        target_id: 'u002',
        source: 'people',
        before_json: JSON.stringify({ reason: 'people_offboarding' }),
        after_json: JSON.stringify({ subjectFound: true, revokedAssignments: 3 }),
        created_at: '2026-06-29 11:00:00'
      } as RowDataPacket
    ])

    const result = await listPeopleLifecycleAudits(executor, {
      tenantCode: 'C000001',
      page: 1,
      pageSize: 20,
      offset: 0,
      keyword: 'u00'
    })

    assert.equal(result.total, 2)
    assert.equal(result.items[0]?.status, 'synced')
    assert.equal(result.items[0]?.after?.roleMatched, true)
    assert.equal(result.items[1]?.status, 'revoked')

    const sql = queries.map(query => query.sql).join('\n')
    assert.match(sql, /action IN \(\?, \?\)/)
    assert.match(sql, /target_type = 'user'/)
    assert.match(sql, /target_id LIKE \?/)
  })

  test('supports action alias filters and reports missing role matches', async () => {
    const { executor, queries } = executorWithRows([
      {
        id: 3,
        tenant_code: 'C000001',
        operator_uid: null,
        action: 'authorization.user.position.sync.from_people',
        target_type: 'user',
        target_id: 'u003',
        source: 'people',
        before_json: null,
        after_json: JSON.stringify({ roleMatched: false, candidateCount: 0 }),
        created_at: '2026-06-29 12:00:00'
      } as RowDataPacket
    ])

    const result = await listPeopleLifecycleAudits(executor, {
      tenantCode: 'C000001',
      page: 1,
      pageSize: 20,
      offset: 0,
      uid: 'u003',
      action: 'position_sync',
      source: 'people'
    })

    assert.equal(result.items[0]?.status, 'no_matching_position_role')
    assert.equal(result.items[0]?.uid, 'u003')

    const params = queries[0]?.params || []
    assert.ok(params.includes('authorization.user.position.sync.from_people'))
    assert.ok(params.includes('u003'))
    assert.ok(params.includes('people'))
  })
})
