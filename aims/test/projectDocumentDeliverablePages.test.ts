import assert from 'node:assert/strict'
import test from 'node:test'
import { loadProjectDocumentDeliverablePages, PROJECT_DOCUMENT_DELIVERABLE_MAX_PAGES } from '../server/utils/projectDocumentDeliverablePages'

test('reads every deliverable page with the Runtime limit, including a partial final page', async () => {
  const calls: number[] = []
  const expected = Array.from({ length: 205 }, (_, id) => ({ id }))
  const result = await loadProjectDocumentDeliverablePages(async (page, pageSize) => {
    assert.equal(pageSize, 100)
    calls.push(page)
    return { items: expected.slice((page - 1) * pageSize, page * pageSize), total: expected.length }
  })
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(result, expected)
})

test('an empty result succeeds, but an empty page before the total fails closed', async () => {
  assert.deepEqual(await loadProjectDocumentDeliverablePages(async () => ({ items: [], total: 0 })), [])
  await assert.rejects(loadProjectDocumentDeliverablePages(async () => ({ items: [], total: 2 })), { statusCode: 503, data: { code: 'project_document_deliverables_incomplete' } })
})

test('a later dependency failure never resolves with the already read partial list', async () => {
  const dependencyError = new Error('fixture dependency failure')
  let calls = 0
  await assert.rejects(loadProjectDocumentDeliverablePages(async (page) => {
    calls++
    if (page === 2) throw dependencyError
    return { items: Array.from({ length: 100 }, (_, id) => id), total: 101 }
  }), error => error === dependencyError)
  assert.equal(calls, 2)
})

test('hitting the page bound fails explicitly rather than returning a truncated list', async () => {
  let calls = 0
  await assert.rejects(loadProjectDocumentDeliverablePages(async () => {
    calls++
    return { items: Array.from({ length: 100 }, (_, id) => id) }
  }), { statusCode: 503, data: { code: 'project_document_deliverables_page_limit' } })
  assert.equal(calls, PROJECT_DOCUMENT_DELIVERABLE_MAX_PAGES)
})

test('an exact full-page total completes without an extra request; malformed pages fail closed', async () => {
  let calls = 0
  assert.equal((await loadProjectDocumentDeliverablePages(async () => {
    calls++
    return { items: Array.from({ length: 100 }, (_, id) => id), total: 100 }
  })).length, 100)
  assert.equal(calls, 1)
  await assert.rejects(loadProjectDocumentDeliverablePages(async () => ({ total: 0 })), { statusCode: 502 })
  await assert.rejects(loadProjectDocumentDeliverablePages(async () => ({ items: [1], total: 0 })), { statusCode: 502 })
})
