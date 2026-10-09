import test from 'node:test'
import assert from 'node:assert/strict'
import { consoleSyncReadQuery } from '../shared/utils/consoleSyncReadQuery'

test('sync query preserves legacy limit and rejects mixed or invalid pagination', () => {
  assert.deepEqual(consoleSyncReadQuery({}), {})
  assert.deepEqual(consoleSyncReadQuery({ limit: '100' }), { limit: '100' })
  assert.deepEqual(consoleSyncReadQuery({ page: '2', pageSize: '20' }), { page: '2', pageSize: '20' })
  for (const query of [{ page: '1', limit: '20' }, { page: ['1', '2'] }, { page: '01' }, { pageSize: '101' }, { limit: ['20', '30'] }, { limit: '' }, { status: 'failed' }]) assert.throws(() => consoleSyncReadQuery(query))
})
