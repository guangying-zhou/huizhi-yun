import test from 'node:test'
import assert from 'node:assert/strict'
import { productReleaseDiffInput } from '../server/utils/productReleaseDiffInput'

const query = { beforeVersionId: '1', beforeRecordId: '2', afterVersionId: '3', afterRecordId: '4' }
test('release diff preserves direction and bounds pagination', () => {
  assert.deepEqual(productReleaseDiffInput({ ...query, page: '2', pageSize: '10' }), { before_version_id: 1, before_record_id: 2, after_version_id: 3, after_record_id: 4, page: 2, page_size: 10 })
  for (const invalid of [{ ...query, actor: 'other' }, { ...query, beforeRecordId: '0' }, { ...query, afterVersionId: ['3'] }, { ...query, pageSize: '101' }, { ...query, page: '0' }, { ...query, afterRecordId: '9007199254740992' }]) assert.equal(productReleaseDiffInput(invalid), null)
})
