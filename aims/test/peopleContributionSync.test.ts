import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildContributionIdempotencyKey,
  contributionInputHash,
  groupContributionItems
} from '../server/utils/peopleContributionSync.ts'

describe('Aims to People contribution sync identity', () => {
  test('aggregates period time entries and preserves traceable source references', () => {
    const items = groupContributionItems([
      { id: 11, uid: 'u-1', projectCode: 'PRJ-1', itemKey: 'PRJ-1-1', hours: 40 },
      { id: 12, uid: 'u-1', projectCode: 'PRJ-1', itemKey: 'PRJ-1-1', hours: '40' }
    ], {})

    assert.deepEqual(items, [{
      employee_uid: 'u-1',
      project_code: 'PRJ-1',
      role_code: 'delivery',
      work_hours: 80,
      score_status: 'unscored',
      source_app: 'aims',
      source_biz_type: 'time_entries',
      source_biz_id: 'PRJ-1:u-1',
      source_refs: {
        time_entries: [11, 12],
        work_items: ['PRJ-1-1'],
        review_status: 'approved'
      }
    }])
  })

  test('uses the trusted route project id in the stable replay key', () => {
    const input = {
      projectId: 'route-project-42',
      cycleCode: 'CYCLE-202607',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      inputHash: 'a'.repeat(64)
    }
    assert.equal(
      buildContributionIdempotencyKey(input),
      `aims:people-contributions:route-project-42:CYCLE-202607:2026-07-01:2026-07-31:${'a'.repeat(64)}`
    )
    assert.equal(buildContributionIdempotencyKey(input), buildContributionIdempotencyKey(input))
  })

  test('keeps an explicit idempotency key', () => {
    assert.equal(buildContributionIdempotencyKey({
      explicitIdempotencyKey: 'request-123',
      projectId: '42',
      cycleCode: 'C1',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31'
    }), 'request-123')
  })

  test('hashes contribution content independently of item order', () => {
    const first = [{ employee_uid: 'u-2', source_biz_id: 'P:u-2' }, { employee_uid: 'u-1', source_biz_id: 'P:u-1' }]
    const second = [...first].reverse()
    assert.equal(contributionInputHash(first), contributionInputHash(second))
    assert.notEqual(contributionInputHash(first), contributionInputHash([{ employee_uid: 'u-1', source_biz_id: 'P:u-1', work_hours: 1 }]))
  })

  test('freezes a trusted snapshot before dispatch and never calls People directly', () => {
    const route = readFileSync(
      new URL('../server/api/v1/projects/[id]/people-contributions/sync.post.ts', import.meta.url),
      'utf8'
    )
    const permissionIndex = route.indexOf('requirePermission(event, \'projects\', \'edit\'')
    assert.ok(permissionIndex >= 0)
    assert.ok(permissionIndex < route.lastIndexOf('people-contributions:freeze'))
    assert.match(route, /buildAimsProjectRuntimeAccessQuery/)
    assert.match(route, /dispatchPeopleContributionOperation\(event, operationKey\)/)
    assert.match(route, /setResponseStatus\(event, 202\)/)
    assert.doesNotMatch(route, /resolveServiceAppBaseUrl/)
    assert.doesNotMatch(route, /requestServiceAccessToken/)
    assert.doesNotMatch(route, /project_code:\s*body/)
    assert.doesNotMatch(route, /targetApp:\s*body/)
    assert.doesNotMatch(route, /requiredCapability:\s*body/)
  })
})
