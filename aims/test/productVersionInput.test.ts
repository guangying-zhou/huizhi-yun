import assert from 'node:assert/strict'
import test from 'node:test'
import { productVersionCreateInput, productVersionPageInput, productVersionEditInput, productVersionID } from '../server/utils/productVersionInput.ts'

test('product version creation binds initial state on the server', () => {
  const draft = { expectedRevision: 1, versionCode: '2026.09', name: '九月版本', plannedReleaseDate: '2026-09-30' }
  assert.equal(productVersionCreateInput(draft)?.version_code, '2026.09')
  assert.equal(productVersionCreateInput({ ...draft, plannedReleaseDate: '2028-02-29' })?.planned_release_date, '2028-02-29')
  assert.equal(productVersionCreateInput({ ...draft, planningMode: 'simple' })?.planning_mode, 'simple')
  for (const extra of [{ ownerProjectId: 1 }, { status: 'released' }, { releasedBy: 'admin' }, { productCode: 'OTHER' }, { expectedRevision: '1' }, { versionCode: ' v1' }, { versionCode: 'v\n1' }, { plannedReleaseDate: '2026-02-29' }, { plannedReleaseDate: '0001-01-01' }, { name: '字'.repeat(201) }]) assert.equal(productVersionCreateInput({ ...draft, ...extra }), null)
})
test('version lists validate pagination and historical statuses', () => {
  assert.equal(productVersionPageInput({ page: '2', pageSize: '10', status: 'released', keyword: '%_' })?.page, 2)
  for (const query of [{ status: 'published' }, { projectCode: 'OTHER' }, { pageSize: '101' }, { page: '-1' }, { page: ['1', '2'] }]) assert.equal(productVersionPageInput(query), null)
})

test('version edit binds path ID and requires both revisions and reason', () => {
  const draft = { expectedRevision: 2, expectedVersionRevision: 1, versionCode: 'v1', reason: '更新计划说明' }
  assert.equal(productVersionEditInput(draft, 3)?.version_id, 3)
  assert.equal(productVersionEditInput({ ...draft, planningMode: 'simple' }, 3), null)
  for (const raw of ['0', '-1', '01', '1.5', '1e2', '9007199254740992', undefined]) assert.equal(productVersionID(raw), null)
  assert.equal(productVersionID('42'), 42)
  for (const extra of [{ expectedVersionRevision: 0 }, { reason: '' }, { reason: '字'.repeat(2001) }, { versionId: 4 }, { status: 'released' }]) assert.equal(productVersionEditInput({ ...draft, ...extra }, 3), null)
})

test('version owner is explicit and cannot be cleared accidentally', () => {
  const body = { expectedRevision: 1, versionCode: 'v1', businessOwnerUid: 'pm' }
  assert.equal(productVersionCreateInput(body)?.business_owner_uid, 'pm')
  for (const businessOwnerUid of [null, '', ' pm', 123, 'x'.repeat(65), '\0']) assert.equal(productVersionCreateInput({ ...body, businessOwnerUid }), null)
  assert.equal(productVersionCreateInput({ expectedRevision: 1, versionCode: 'v1' })?.business_owner_uid, undefined)
})
