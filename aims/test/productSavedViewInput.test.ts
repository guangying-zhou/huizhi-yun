import test from 'node:test'
import assert from 'node:assert/strict'
import { productSavedViewDefinition, productSavedViewReadInput, productSavedViewWriteInput } from '../server/utils/productSavedViewInput'

const id = '00000000-0000-4000-8000-000000000001'
const definition = { title: '季度路线', audience: 'delivery', visibility: 'personal', cycleId: id, year: 2026, quarter: 4, unscheduled: false }
test('saved view writes bind route identity and preserve explicit filters', () => {
  assert.equal(productSavedViewDefinition(definition)?.unscheduled, false)
  assert.equal(productSavedViewDefinition({ ...definition, unscheduled: true })?.unscheduled, true)
  assert.deepEqual(productSavedViewWriteInput('delete', { expectedRevision: 2, expectedViewRevision: 1 }, id), { biz_id: id, expected_view_revision: 1, expected_revision: 2 })
  assert.ok(productSavedViewWriteInput('create', { expectedRevision: 1, definition }))
  assert.ok(productSavedViewWriteInput('update', { expectedRevision: 2, expectedViewRevision: 1, definition }, id))
  for (const extra of [{ owner: 'other' }, { authorization: {} }, { productCode: 'other' }, { pageSize: 1000 }]) assert.equal(productSavedViewDefinition({ ...definition, ...extra }), null)
  for (const patch of [{ visibility: 'public' }, { audience: 'admin' }, { quarter: 0 }, { year: '2026' }, { unscheduled: undefined }, { cycleId: 'bad' }, { title: '\uD800' }]) assert.equal(productSavedViewDefinition({ ...definition, ...patch }), null)
  for (const expectedRevision of [0, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(productSavedViewWriteInput('create', { expectedRevision, definition }), null)
  assert.equal(productSavedViewWriteInput('delete', { expectedRevision: 2, expectedViewRevision: 1, definition }, id), null)
  assert.equal(productSavedViewWriteInput('update', { expectedRevision: 2, expectedViewRevision: 1, definition }, 'bad'), null)
})
test('saved view reads whitelist pagination and reject view parameter overrides', () => {
  assert.deepEqual(productSavedViewReadInput('apply', { page: '2', pageSize: '10' }, id), { biz_id: id, page: 2, page_size: 10 })
  assert.deepEqual(productSavedViewReadInput('view', {}, id), { biz_id: id })
  assert.equal(productSavedViewReadInput('view', { page: '1' }, id), null)
  for (const query of [{ owner: 'other' }, { pageSize: '101' }, { page: ['1'] }, { year: '2027' }]) assert.equal(productSavedViewReadInput('list', query), null)
})
