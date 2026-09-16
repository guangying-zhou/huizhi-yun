import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProductVersionExecution, requireCompleteProductExecutionVisibility } from '../server/utils/productVersionExecutionVisibility'
import type { ProductVersionAcceptancePreview, VersionExecutionItem } from '../app/types/productVersionAcceptance'

test('project visibility removes denied details but preserves aggregates and review hash', async () => {
  const item = (id: number, project_id: number) => ({ id, project_id, title: `private-${id}` } as VersionExecutionItem)
  const input = { review_hash: 'frozen', execution: { targets: [item(1, 10), item(2, 20)], open_defects: [item(3, 20)], total_weight: 8, completed_weight: 3, content_hash: 'frozen-execution' } } as ProductVersionAcceptancePreview
  const calls: number[] = []
  const result = await filterProductVersionExecution(input, async (id) => {
    calls.push(id)
    return id === 10
  })
  assert.deepEqual(calls, [10, 20])
  assert.deepEqual(result.execution.targets.map(row => row.id), [1])
  assert.deepEqual(result.execution.open_defects, [])
  assert.equal(result.execution.restricted_item_count, 2)
  assert.equal(result.execution.target_count, 2)
  assert.equal(result.execution.open_defect_count, 1)
  assert.equal(result.execution.total_weight, 8)
  assert.equal(result.review_hash, 'frozen')
  assert.equal(JSON.stringify(result).includes('private-2'), false)
  assert.equal(input.execution.targets.length, 2)
  await assert.rejects(filterProductVersionExecution(input, async () => {
    throw new Error('authorization unavailable')
  }), /authorization unavailable/)
})

test('write preflight rejects a denied project and propagates authorization outages', async () => {
  const preview = { execution: { targets: [{ project_id: 10 }], open_defects: [] } } as unknown as ProductVersionAcceptancePreview
  await assert.rejects(requireCompleteProductExecutionVisibility(preview, async () => false), { statusCode: 403 })
  await requireCompleteProductExecutionVisibility(preview, async () => true)
  await assert.rejects(requireCompleteProductExecutionVisibility(preview, async () => Promise.reject(new Error('Console unavailable'))), /Console unavailable/)
})
