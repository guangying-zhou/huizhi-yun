import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directoryActiveStatusData } from '../server/utils/directoryActiveStatusData.ts'

test('active-status contract rejects old display projections and malformed or unrelated UID data', () => {
  for (const data of [undefined, [], [{ uid: 'u1', realName: 'User' }], [{ uid: 'u1', active: 'true' }], [{ uid: 'u2', active: true }], [null]]) {
    assert.equal(directoryActiveStatusData(['u1'], { code: 0, data }), null)
  }
  assert.equal(directoryActiveStatusData(['u1', 'u2'], { code: 0, data: [{ uid: 'u1', active: true }, { uid: 'u1', active: true }] }), null)
  assert.equal(directoryActiveStatusData(['u1'], { code: 500, data: [{ uid: 'u1', active: true }] }), null)
  assert.deepEqual(directoryActiveStatusData(['u1'], { code: 0, data: [{ uid: 'u1', active: false, realName: 'not forwarded' }] }), [{ uid: 'u1', active: false }])
})
