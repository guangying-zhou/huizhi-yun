import assert from 'node:assert/strict'
import test from 'node:test'
import * as Y from 'yjs'
import { PersistenceExtension } from '../src/extensions/persistence.js'
import type { OssConfig } from '../src/config.js'

const context = {
  docId: 1,
  docUuid: '2f5f6e38-3942-4be7-ba35-4ad37c64fd14',
  docType: 'private',
  ossPath: 'codocs/users/owner/doc.md',
  ownerUid: 'owner',
  actorUid: 'owner',
  actorName: 'Owner',
  sharePermission: null,
  readonly: false
}

function extension() {
  return new PersistenceExtension({
    bucketName: '', endpoint: '', accessKeyId: '', accessKeySecret: '', region: ''
  } satisfies OssConfig)
}

test('a missing or failing OSS client never treats a loaded document as empty', async () => {
  const persistence = extension()
  const document = new Y.Doc()
  const payload = { documentName: `doc:${context.docUuid}`, document, context }
  await assert.rejects(persistence.onLoadDocument(payload as Parameters<PersistenceExtension['onLoadDocument']>[0]), /collab-storage-unavailable/)

  Object.assign(persistence, { defaultClient: { get: async () => { throw new Error('storage temporarily unavailable') } } })
  await assert.rejects(persistence.onLoadDocument(payload as Parameters<PersistenceExtension['onLoadDocument']>[0]), /storage temporarily unavailable/)
  assert.equal(document.getText('content').length, 0)
})

test('a genuinely missing Yjs snapshot still loads the Markdown fallback', async () => {
  const persistence = extension()
  let reads = 0
  Object.assign(persistence, { defaultClient: {
    get: async () => {
      reads++
      if (reads === 1) throw Object.assign(new Error('missing Yjs snapshot'), { code: 'NoSuchKey' })
      return { content: Buffer.from('existing Markdown') }
    }
  } })
  const document = new Y.Doc()
  await persistence.onLoadDocument({ documentName: `doc:${context.docUuid}`, document, context } as Parameters<PersistenceExtension['onLoadDocument']>[0])
  assert.equal(reads, 2)
  assert.equal(document.getText('content').toString(), 'existing Markdown')
})

test('a failed snapshot upload is reported to the collaboration runtime', async () => {
  const persistence = extension()
  Object.assign(persistence, { defaultClient: { put: async () => { throw new Error('snapshot upload failed') } } })
  const document = new Y.Doc()
  document.getText('content').insert(0, 'edited content')
  await assert.rejects(persistence.onStoreDocument({
    documentName: `doc:${context.docUuid}`, document, context
  } as Parameters<PersistenceExtension['onStoreDocument']>[0]), /snapshot upload failed/)
})
