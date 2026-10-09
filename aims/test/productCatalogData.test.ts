import { test } from 'node:test'
import assert from 'node:assert/strict'
import { productCatalogPage } from '../server/utils/productCatalogData.ts'

const item = {
  product_code: 'P-1', product_name: '产品一', product_line: 'software',
  product_line_label: null, product_line_sort_order: null, source_status: 'mvp',
  source_updated_at: '2026-09-07T12:00:00.000Z', business_owner_uid: null,
  technical_owner_uid: null, onboardable: true
}
const page = {
  items: [item], total: 2, page: 1, pageSize: 1,
  watermark: '12345678-1234-1234-1234-123456789012:1', nextPage: 2
}

test('catalog preserves source watermark and bounded page navigation', () => {
  assert.deepEqual(productCatalogPage(page), page)
  const last = { ...page, page: 2, nextPage: null }
  assert.deepEqual(productCatalogPage(last), last)
  const empty = { ...page, items: [], total: 0, nextPage: null }
  assert.deepEqual(productCatalogPage(empty), empty)
})

test('catalog rejects incomplete pages, legacy responses and malformed source facts', () => {
  for (const patch of [
    { watermark: '------------------------------------:1' }, { watermark: page.watermark.replace(':1', ':0') },
    { total: 2.5 }, { total: -1 }, { pageSize: 101 }, { page: 0 },
    { items: [] }, { nextPage: null }, { items: [item, item], pageSize: 2, nextPage: null },
    { items: [{ ...item, onboardable: 'true' }] },
    { items: [{ ...item, source_updated_at: 'unknown' }] },
    { items: [{ ...item, business_owner_uid: undefined }] }
  ]) assert.equal(productCatalogPage({ ...page, ...patch }), null, JSON.stringify(patch))
  assert.equal(productCatalogPage({ items: [item], total: 1 }), null)
})
