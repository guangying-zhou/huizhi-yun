import test from 'node:test'
import assert from 'node:assert/strict'
import { notificationReadQuery } from '../shared/utils/notificationReadQuery'

test('notification query preserves legacy cursor and strictly separates page mode', () => {
  assert.deepEqual(notificationReadQuery({}), {})
  assert.deepEqual(notificationReadQuery({ status: 'unread', cursor: '9', limit: '20' }), { status: 'unread', cursor: '9', limit: '20' })
  assert.deepEqual(notificationReadQuery({ page: '2', pageSize: '100', sourceAppCode: 'aims' }), { page: '2', pageSize: '100', sourceAppCode: 'aims' })
  for (const query of [{ page: '1', cursor: '' }, { pageSize: '20', limit: '20' }, { page: ['1', '2'] }, { page: '01' }, { page: '1.5' }, { page: '' }, { pageSize: '101' }, { uid: 'victim' }, { status: 'forged' }, { category: 'x'.repeat(65) }, { sourceAppCode: ['aims', 'assets'] }]) assert.throws(() => notificationReadQuery(query))
})
