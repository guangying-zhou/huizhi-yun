import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directoryActiveStatuses } from '../server/utils/directoryActiveStatus.ts'

test('minimal Directory status fails closed for disabled, deleted, missing and unknown subjects', () => {
  assert.deepEqual(directoryActiveStatuses(['active', 'numeric', 'disabled', 'deleted', 'unknown', 'missing', 'active'], [
    { uid: 'active', statusKey: 'active' }, { uid: 'numeric', status: 1 },
    { uid: 'disabled', statusKey: 'inactive', status: 1 }, { uid: 'deleted', status: -1 },
    { uid: 'unknown', status: 'pending' }
  ]), [
    { uid: 'active', active: true }, { uid: 'numeric', active: true },
    { uid: 'disabled', active: false }, { uid: 'deleted', active: false },
    { uid: 'unknown', active: false }, { uid: 'missing', active: false }
  ])
})
