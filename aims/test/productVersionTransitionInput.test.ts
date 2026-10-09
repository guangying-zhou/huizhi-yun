import test from 'node:test'
import assert from 'node:assert/strict'
import { productVersionTransitionInput } from '../server/utils/productVersionTransitionInput'

test('transition binds the path and permits only an explicit development decision', () => {
  const body = { expectedRevision: 2, expectedVersionRevision: 1, toStatus: 'developing', reason: '范围已确认，开始实施' }
  assert.deepEqual(productVersionTransitionInput(body, 7), { version_id: 7, expected_revision: 2, expected_version_revision: 1, to_status: 'developing', reason: body.reason })
  for (const extra of [{ toStatus: 'released' }, { toStatus: 'planning' }, { actorUid: 'admin' }, { version_id: 9 }, { expectedRevision: '2' }, { expectedVersionRevision: 0 }, { reason: ' ' }, { reason: '\0' }, { reason: '\ud800' }, { reason: '字'.repeat(2001) }]) assert.equal(productVersionTransitionInput({ ...body, ...extra }, 7), null)
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(productVersionTransitionInput(body, id), null)
})
