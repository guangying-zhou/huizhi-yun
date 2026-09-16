import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productCommandKey, workspaceChangeInput } from '../server/utils/productWorkspaceInput.ts'

const input = { expectedRevision: 1, positioning: '定位', targetUsers: null, valueStatement: '' }

test('workspace edit preserves explicit clearing, rejects omissions and does not accept authorization or state fields', () => {
  assert.deepEqual(workspaceChangeInput('edit', input), {
    expected_revision: 1, positioning: '定位', target_users: null, value_statement: '', reason: ''
  })
  const { targetUsers: _omitted, ...incomplete } = input
  assert.equal(workspaceChangeInput('edit', incomplete), null)
  for (const extra of [{ authorization: {} }, { current_user: 'admin' }, { status: 'active' }, { product_code: 'P-B' }, { revision: 5 }]) {
    assert.equal(workspaceChangeInput('edit', { ...input, ...extra }), null)
  }
  for (const expectedRevision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(workspaceChangeInput('edit', { ...input, expectedRevision }), null)
  }
})

test('workspace lifecycle requires an explicit reason and revision without accepting positioning edits', () => {
  for (const action of ['archive', 'restore'] as const) {
    assert.deepEqual(workspaceChangeInput(action, { expectedRevision: 2, reason: '产品调整' }), { expected_revision: 2, reason: '产品调整' })
    assert.equal(workspaceChangeInput(action, { expectedRevision: 2, reason: ' ' }), null)
    assert.equal(workspaceChangeInput(action, { ...input, reason: '产品调整' }), null)
  }
  assert.equal(workspaceChangeInput('edit', { ...input, positioning: '字'.repeat(10001) }), null)
  assert.equal(workspaceChangeInput('edit', { ...input, positioning: 1 }), null)
})

test('command keys cannot be missing, padded, oversized or contain control characters', () => {
  for (const key of [undefined, '', ' padded ', 'bad\nkey', 'x'.repeat(192)]) assert.equal(productCommandKey(key), null)
  assert.equal(productCommandKey('workspace-edit-123'), 'workspace-edit-123')
})
