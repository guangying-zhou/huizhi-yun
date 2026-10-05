import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { uploadPreparedProductDocument, type ProductCreationSnapshot } from '../server/utils/productDocumentCreationUpload'

const operationId = '00000000-0000-4000-8000-000000000001'
const documentUuid = '00000000-0000-4000-8000-000000000002'
const expected = { operationId, documentUuid }
const snapshot: ProductCreationSnapshot = { ...expected, content: '冻结正文', contentSha256: createHash('sha256').update('冻结正文').digest('hex'), state: 'prepared', publishedPath: '' }
test('prepared creation uploads frozen bytes; completed replay skips upload', async () => {
  const uploads: string[] = [], completions: string[] = []
  const dependencies = {
    upload: async (path: string, content: string, type: string) => {
      assert.equal(content, snapshot.content)
      assert.equal(type, 'product')
      uploads.push(path)
    },
    complete: async (path: string, hash: string) => {
      assert.equal(hash, snapshot.contentSha256)
      completions.push(path)
      return 'receipt'
    }
  }
  await uploadPreparedProductDocument(snapshot, expected, dependencies)
  await uploadPreparedProductDocument(snapshot, expected, dependencies)
  assert.notEqual(uploads[0], uploads[1])
  assert.equal(await uploadPreparedProductDocument({ ...snapshot, state: 'completed', publishedPath: uploads[0]! }, expected, dependencies), 'receipt')
  assert.equal(uploads.length, 2)
  assert.equal(completions[2], uploads[0])
})
test('invalid snapshots and upload failure cannot reach completion', async () => {
  let uploaded = 0, completed = 0
  const dependencies = { upload: async () => {
    uploaded++
  }, complete: async () => {
    completed++
  } }
  for (const invalid of [{ ...snapshot, content: 'changed' }, { ...snapshot, documentUuid: operationId }, { ...snapshot, state: 'completed' as const, publishedPath: 'untrusted/path' }]) await assert.rejects(uploadPreparedProductDocument(invalid, expected, dependencies), { statusCode: 503 })
  assert.equal(uploaded, 0)
  await assert.rejects(uploadPreparedProductDocument(snapshot, expected, { ...dependencies, upload: async () => {
    throw new Error('private storage diagnostic')
  } }), (error: unknown) => {
    assert.equal((error as { statusCode: number }).statusCode, 503)
    assert.equal(String(error).includes('private storage'), false)
    return true
  })
  assert.equal(completed, 0)
})
