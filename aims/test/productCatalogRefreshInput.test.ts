import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogRefreshInput } from '../server/utils/productCatalogRefreshInput.ts'

const refreshId = '12345678-1234-1234-1234-123456789012'
test('catalog refresh accepts only server-managed batch continuation, never source rows or cursors', () => {
  assert.ok(catalogRefreshInput({ action: 'start' }))
  assert.ok(catalogRefreshInput({ action: 'continue', refreshId, expectedRevision: 1 }))
  for (const raw of [{ action: 'start', refreshId }, { action: 'continue', refreshId }, { action: 'continue', refreshId, expectedRevision: 0 }, { action: 'status', refreshId: '../other' }, { action: 'status', refreshId, page: 2 }, { action: 'continue', refreshId, expectedRevision: 1, items: [] }, { action: 'cancel', refreshId, authorization: {} }]) assert.equal(catalogRefreshInput(raw), null)
})
