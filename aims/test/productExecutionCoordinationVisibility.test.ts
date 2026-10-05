import test from 'node:test'
import assert from 'node:assert/strict'
import { filterExecutionCoordination } from '../server/utils/productExecutionCoordinationVisibility'
const counts = { target_count: 1, incomplete_target_count: 1, open_defect_count: 0, total_weight: 2, completed_weight: 0, no_execution_plan: false }
const value = { product_code: 'P', version_id: 1, workspace_revision: 1, defect_coverage: 'linked-descendants-only', ...counts, target_count: 3, incomplete_target_count: 3, total_weight: 6, projects: [1, 2, 3].map(project_id => ({ ...counts, project_id, secret: 'must not pass' })) }
test('coordination filters before pagination and keeps full product totals', async () => {
  const checked: number[] = []
  const result = await filterExecutionCoordination(value, 'P', 1, 2, 1, async id => { checked.push(id); return id !== 2 })
  assert.deepEqual(checked, [1, 2, 3])
  assert.equal(result.total_weight, 6)
  assert.equal(result.total, 2)
  assert.equal(result.restricted_project_count, 1)
  assert.deepEqual(result.projects, [{ ...counts, project_id: 3 }])
  const hidden = await filterExecutionCoordination(value, 'P', 1, 1, 20, async () => false)
  assert.deepEqual(hidden.projects, [])
  assert.equal(hidden.total, 0)
  assert.equal(hidden.restricted_project_count, 3)
})
test('coordination rejects malformed facts before authorization and preserves service failure', async () => {
  for (const input of [{ ...value, product_code: 'OTHER' }, { ...value, total_weight: 7 }, { ...value, no_execution_plan: true }, { ...value, projects: [value.projects[0]!, value.projects[0]!, value.projects[2]!] }]) {
    let checked = false
    await assert.rejects(filterExecutionCoordination(input, 'P', 1, 1, 20, async () => { checked = true; return true }))
    assert.equal(checked, false)
  }
  const outage = new Error('authorization unavailable')
  await assert.rejects(filterExecutionCoordination(value, 'P', 1, 1, 20, async () => { throw outage }), err => err === outage)
})

test('coordination sums safe integer counters exactly without overflowing Number', async () => {
  const maximum = Number.MAX_SAFE_INTEGER
  const exact = {
    ...value,
    target_count: maximum,
    incomplete_target_count: maximum,
    total_weight: maximum,
    completed_weight: maximum,
    projects: [
      { ...counts, project_id: 1, target_count: maximum - 1, incomplete_target_count: maximum - 1, total_weight: maximum - 1, completed_weight: maximum - 1 },
      { ...counts, project_id: 2, target_count: 1, incomplete_target_count: 1, total_weight: 1, completed_weight: 1 }
    ]
  }
  const result = await filterExecutionCoordination(exact, 'P', 1, 1, 20, async () => true)
  assert.equal(result.total_weight, maximum)
  assert.equal(result.projects.length, 2)

  await assert.rejects(filterExecutionCoordination({
    ...exact,
    projects: exact.projects.map((project, index) => index ? { ...project, total_weight: 2 } : project)
  }, 'P', 1, 1, 20, async () => true), /协调汇总与项目统计不一致/)
})
