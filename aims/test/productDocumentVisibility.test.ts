import test from 'node:test'
import assert from 'node:assert/strict'
import { createError } from 'h3'
import { pageVisibleProductDocuments, type ProductDocumentRelation } from '../server/utils/productDocumentVisibility'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const rows: ProductDocumentRelation[] = Array.from({ length: 105 }, (_, i) => ({ biz_id: id(i + 1), document_uuid: id(i + 201), product_code: 'P', purpose: 'design', revision: 1, removed: false }))
function setup() {
  const read: string[] = [], pages: number[] = [], verified: number[] = []
  return {
    read, pages, verified,
    options: {
      productCode: 'P', page: 2, pageSize: 20, removed: false, purpose: 'design',
      loadCandidates: async (page: number, pageSize: number) => {
        pages.push(page)
        return { product_code: 'P', workspace_revision: 3, items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }
      },
      readMetadata: async (uuid: string) => {
        read.push(uuid)
        return Number(uuid.slice(-12)) % 2 ? null : { uuid, title: '可见文档', doc_type: 'product', updated_at: '2026-09-08', secret: 'hidden' }
      },
      verifyRevision: async (revision: number) => { verified.push(revision) }
    }
  }
}
test('document visibility filters all candidate pages before counting and slicing', async () => {
  const h = setup()
  const result = await pageVisibleProductDocuments(h.options)
  assert.deepEqual(h.pages, [1, 2])
  assert.equal(h.read.length, 105)
  assert.deepEqual(h.verified, [3])
  assert.equal(result.total, 52)
  assert.equal(result.restrictedCount, 53)
  assert.equal(result.items.length, 20)
  assert.equal(result.items[0]?.document_uuid, id(242))
  assert.equal(result.items[19]?.document_uuid, id(280))
  assert.ok(!JSON.stringify(result).includes('hidden'))
  assert.ok(!JSON.stringify(result).includes(id(201)))
  const empty = await pageVisibleProductDocuments({ ...h.options, page: 4 })
  assert.equal(empty.total, 52)
  assert.deepEqual(empty.items, [])
})
test('document visibility rejects drift, duplicates and outages without partial results', async () => {
  const h = setup()
  await assert.rejects(pageVisibleProductDocuments({ ...h.options, loadCandidates: async (page, size) => ({ ...await h.options.loadCandidates(page, size), workspace_revision: page === 2 ? 4 : 3 }) }), { statusCode: 409 })
  await assert.rejects(pageVisibleProductDocuments({ ...h.options, verifyRevision: async () => {
    throw createError({ statusCode: 409 })
  } }), { statusCode: 409 })
  await assert.rejects(pageVisibleProductDocuments({ ...h.options, readMetadata: async () => {
    throw createError({ statusCode: 503 })
  } }), { statusCode: 503 })
  await assert.rejects(pageVisibleProductDocuments({ ...h.options, loadCandidates: async (page, size) => ({ ...await h.options.loadCandidates(page, size), items: Array(100).fill(rows[0]) }) }), { statusCode: 503 })
})
