/* eslint-disable @stylistic/max-statements-per-line -- compact fake collaborators keep each scenario's call order readable */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'
import { assertLegacyBodyDocument, isSnapshotV2Document, parseBodyRef, readBodyByRef } from '../server/utils/documentBodyRef.ts'
import { copyQuickPublishDocument, type QuickPublishStorage } from '../server/utils/companyAssetQuickPublish.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...args: any[]) => any

function failure(statusCode: number, message = 'failure') {
  return Object.assign(new Error(message), { statusCode })
}

function load(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, Fn> = {}
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
    Buffer,
    ...globals
  })
  return exports
}

const body = Buffer.from('# exact published body')
const sha = createHash('sha256').update(body).digest('hex')
const ref = { generation: 4, epoch: 2, markdown: { key: 'codocs/snapshots/h/uuid/c/attempt/body.md', version: 'v-4' }, size: body.length, sha256: sha }
const documentBodyRef = { assertLegacyBodyDocument, isSnapshotV2Document, parseBodyRef, readBodyByRef }

// High-risk C5: the legacy PUT used to write OSS first and only then be refused by Runtime.
test('legacy PUT refuses a v2 document before any OSS write or version record', async () => {
  const calls: string[] = []
  const api = load('../server/api/documents/[uuid]/index.put.ts', {
    '~~/server/utils/oss': { uploadDocument: async () => { calls.push('oss-write'); return { versionId: 'v' } } },
    'node:crypto': { createHash },
    '~~/server/utils/authIdentity': { requireRequestUid: () => 'owner' },
    '~~/server/utils/documentBodyRef': documentBodyRef,
    '~~/server/utils/codocsRuntime': {
      getCodocsDocumentMetadata: async () => ({ id: 1, uuid: 'doc', title: 't', doc_type: 'department', oss_path: 'codocs/departments/D1/a.md', readonly: false, snapshot_generation: 2 }),
      updateCodocsDocumentMetadata: async () => { calls.push('runtime-update') },
      createCodocsDocumentVersion: async () => { calls.push('runtime-version') }
    }
  }, {
    defineEventHandler: (fn: Fn) => fn,
    getRouterParam: () => 'doc',
    readBody: async () => ({ content: '# stale', saveMode: 'overwrite' }),
    getCookie: () => null,
    createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
    reportOperationAudit: async () => {},
    console: { error: () => {} }
  })
  await assert.rejects(api.default!({ context: {} }), { statusCode: 409 })
  assert.deepEqual(calls, [])
})

test('legacy PUT keeps v1 saves and v2 metadata-only edits', async () => {
  for (const scenario of ['v1-content', 'v2-title-only']) {
    const calls: string[] = []
    const api = load('../server/api/documents/[uuid]/index.put.ts', {
      '~~/server/utils/oss': { uploadDocument: async () => { calls.push('oss-write'); return { versionId: 'v' } } },
      'node:crypto': { createHash },
      '~~/server/utils/authIdentity': { requireRequestUid: () => 'owner' },
      '~~/server/utils/documentBodyRef': documentBodyRef,
      '~~/server/utils/codocsRuntime': {
        getCodocsDocumentMetadata: async () => ({ id: 1, uuid: 'doc', title: 't', doc_type: 'private', oss_path: 'codocs/p/a.md', readonly: false, snapshot_generation: scenario === 'v2-title-only' ? 2 : 0 }),
        updateCodocsDocumentMetadata: async () => { calls.push('runtime-update') },
        createCodocsDocumentVersion: async () => { calls.push('runtime-version') }
      }
    }, {
      defineEventHandler: (fn: Fn) => fn,
      getRouterParam: () => 'doc',
      readBody: async () => scenario === 'v1-content' ? { content: '# ok', saveMode: 'overwrite' } : { title: 'renamed' },
      getCookie: () => null,
      createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
      reportOperationAudit: async () => {},
      console: { error: () => {} }
    })
    await api.default!({ context: {} })
    assert.deepEqual(calls, scenario === 'v1-content' ? ['oss-write', 'runtime-update', 'runtime-version'] : ['runtime-update'], scenario)
  }
})

test('standalone body readers answer 409 for a v2 document before storage', async () => {
  for (const [path, name] of [
    ['../server/api/documents/[uuid]/download.get.ts', 'download'],
    ['../server/api/v1/documents/[uuid]/content.get.ts', 'v1 content']
  ] as const) {
    const calls: string[] = []
    const api = load(path, {
      '~~/server/utils/codocsRuntime': { getCodocsDocumentMetadata: async () => ({ uuid: 'doc', title: 't', doc_type: 'department', oss_path: 'codocs/departments/D1/a.md', snapshot_generation: 1 }) },
      '~~/server/utils/authIdentity': { getRequestUid: () => 'reader' },
      '~~/server/utils/oss': { downloadDocument: async () => { calls.push('oss-read'); return '# stale' } },
      '~~/server/utils/yjsMarkdownRecovery': { hasMeaningfulMarkdownContent: () => true, recoverMarkdownFromYjsSnapshot: async () => { calls.push('yjs-read'); return '' } },
      '~~/server/utils/checkPermission': { requirePermission: async () => {} },
      '~~/server/utils/internalApi': { verifyInternalApi: async () => {} },
      '~~/server/utils/documentBodyRef': documentBodyRef
    }, {
      defineEventHandler: (fn: Fn) => fn,
      getRouterParam: () => 'doc',
      createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
      setResponseHeader: () => {},
      console: { log: () => {}, error: () => {} }
    })
    await assert.rejects(api.default!({ context: {} }), { statusCode: 409 }, name)
    assert.deepEqual(calls, [], name)
  }
})

function freezeHarness(options: { snapshot: boolean, storageFails?: boolean, freezeFails?: boolean }) {
  const calls: string[] = []
  const uploads: Array<[string, string]> = []
  const runtime = async (_event: unknown, path: string, request: { method?: string, body?: Record<string, unknown>, query?: Record<string, unknown> } = {}) => {
    if (path === '/v1/codocs/reviews/publish-requests' && request.method === 'POST') { calls.push('create-request'); return { id: 7 } }
    if (path === '/v1/codocs/reviews/publish-requests') return { items: [] }
    if (request.method === 'PATCH') {
      calls.push(request.body?.workflow_status === 'cancelled' ? 'cancel-request' : `review-path:${request.body?.review_oss_path}`)
      return {}
    }
    throw new Error(`unexpected runtime path ${path}`)
  }
  const api = load('../server/api/reviews/publish-requests/index.post.ts', {
    '~~/server/utils/authIdentity': { requireRequestUid: () => 'owner' },
    '~~/server/utils/checkPermission': { requirePermission: async () => {} },
    '~~/server/utils/directoryCompat': { fetchDirectoryData: async () => ({ flat: [] }) },
    '~~/server/utils/documentBodyRef': documentBodyRef,
    '~~/server/utils/oss': {
      createRuntimeOSSClient: async () => ({ get: async (key: string, o: { versionId?: string }) => {
        calls.push(`snapshot-read:${key}@${o?.versionId}`)
        if (options.storageFails) throw new Error('offline')
        return { content: body }
      } }),
      downloadDocument: async () => { calls.push('mirror-read'); return '# mirror' },
      uploadDocument: async (path: string, content: string) => { calls.push(`upload:${path}`); uploads.push([path, content]) }
    },
    '~~/server/utils/codocsRuntime': {
      callCodocsTenantRuntime: runtime,
      getCodocsDocumentMetadata: async (_event: unknown, _uuid: string, query: Record<string, unknown>) => {
        if (query.include_snapshot_ref) calls.push('frozen-metadata')
        return { id: 9, uuid: 'doc', title: 'Doc', doc_type: 'department', dept_code: 'D1', oss_path: 'codocs/departments/D1/doc.md', snapshot_generation: options.snapshot ? 4 : 0, snapshot_ref: options.snapshot ? ref : undefined }
      },
      updateCodocsDocumentMetadata: async (_event: unknown, _uuid: string, input: Record<string, unknown>) => {
        calls.push(`freeze:${input.readonly_flag}`)
        if (options.freezeFails) throw failure(403, 'owner only')
      }
    }
  }, {
    defineEventHandler: (fn: Fn) => fn,
    readBody: async () => ({ document_uuid: 'doc', review_type: '部门发文' }),
    createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
    console: { warn: () => {}, error: () => {} }
  })
  return { api, calls, uploads }
}

// Q6: readonly + session revocation happen before the body is copied.
test('publish request freezes the document before copying, and copies the exact snapshot for v2', async () => {
  const { api, calls, uploads } = freezeHarness({ snapshot: true })
  await api.default!({ context: {} })
  const freeze = calls.indexOf('freeze:true')
  const read = calls.findIndex(call => call.startsWith('snapshot-read:'))
  assert.ok(freeze > calls.indexOf('create-request') && freeze < read, calls.join(','))
  assert.ok(calls.indexOf('frozen-metadata') > freeze && calls.indexOf('frozen-metadata') < read)
  assert.ok(calls.includes(`snapshot-read:${ref.markdown.key}@v-4`))
  assert.equal(calls.includes('mirror-read'), false)
  assert.deepEqual(uploads, [['codocs/reviews/7_Doc.md', body.toString()]])
  assert.ok(calls.includes('review-path:codocs/reviews/7_Doc.md'))
})

test('v2 freeze cancels the request instead of falling back to the mirror', async () => {
  const { api, calls } = freezeHarness({ snapshot: true, storageFails: true })
  await assert.rejects(api.default!({ context: {} }), { statusCode: 503 })
  assert.equal(calls.includes('mirror-read'), false)
  assert.ok(calls.includes('cancel-request'))
  assert.equal(calls.some(call => call.startsWith('review-path:')), false)
})

test('a failed freeze cancels the draft and never copies the body', async () => {
  const { api, calls } = freezeHarness({ snapshot: true, freezeFails: true })
  await assert.rejects(api.default!({ context: {} }), { statusCode: 403 })
  assert.ok(calls.includes('cancel-request'))
  assert.equal(calls.some(call => call.startsWith('snapshot-read:') || call === 'mirror-read'), false)
})

test('v1 freeze keeps the mirror copy, now after the readonly write', async () => {
  const { api, calls, uploads } = freezeHarness({ snapshot: false })
  await api.default!({ context: {} })
  assert.ok(calls.indexOf('freeze:true') < calls.indexOf('mirror-read'))
  assert.deepEqual(uploads, [['codocs/reviews/7_Doc.md', '# mirror']])
})

function archiveHarness(plan: Record<string, unknown>, storage: { mirror?: string | null, snapshotFails?: boolean } = {}) {
  const calls: string[] = []
  const uploads: Array<[string, string]> = []
  const api = load('../server/api/reviews/[id]/archive.post.ts', {
    '../../../utils/oss': {
      createRuntimeOSSClient: async () => ({ get: async (key: string, o: { versionId?: string }) => {
        calls.push(`snapshot-read:${key}@${o?.versionId}`)
        if (storage.snapshotFails) throw new Error('offline')
        return { content: body }
      } }),
      deleteDocument: async () => { calls.push('delete-review-copy') },
      downloadDocument: async (path: string) => { calls.push(`mirror-read:${path}`); return storage.mirror ?? null },
      uploadDocument: async (path: string, content: string) => { uploads.push([path, content]) }
    },
    '../../../utils/documentBodyRef': documentBodyRef,
    '../../../utils/reviewNotify': { notifyPublished: async () => {}, notifySealAdminsNeeded: async () => {} },
    '~~/server/utils/authIdentity': { requireRequestUid: () => 'owner' },
    '~~/server/utils/checkPermission': { requirePermission: async () => {} },
    '~~/server/utils/codocsRuntime': { callCodocsTenantRuntime: async (_event: unknown, path: string) => {
      if (path.endsWith('/archive-plan')) return plan
      calls.push('commit')
      return { publishedDocumentUuid: 'pub', archiveOssPath: 'codocs/company/rules/x.md' }
    } }
  }, {
    defineEventHandler: (fn: Fn) => fn,
    getRouterParam: () => '7',
    createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
    console: { warn: () => {} }
  })
  return { api, calls, uploads }
}

const archivePlan = { publishRequestId: 7, alreadyArchived: false, sourceOssPath: '', sourceDocumentType: 'department', archiveOssPath: 'codocs/company/rules/x.md', publishedDocumentUuid: 'pub', documentTitle: 'Doc', archiveKey: '公司制度', publishScope: 'company', needsOfficialSeal: false }

test('archive reads the exact snapshot when the plan carries a body reference', async () => {
  const { api, calls, uploads } = archiveHarness({ ...archivePlan, sourceBodyRef: ref })
  await api.default!({ context: {} })
  assert.ok(calls.includes(`snapshot-read:${ref.markdown.key}@v-4`))
  assert.equal(calls.some(call => call.startsWith('mirror-read')), false)
  assert.deepEqual(uploads, [['codocs/company/rules/x.md', body.toString()]])
})

test('archive fails closed when the snapshot cannot be verified or the plan has no source', async () => {
  const failed = archiveHarness({ ...archivePlan, sourceBodyRef: ref }, { snapshotFails: true })
  await assert.rejects(failed.api.default!({ context: {} }), { statusCode: 503 })
  assert.equal(failed.calls.includes('commit'), false)
  const missing = archiveHarness(archivePlan)
  await assert.rejects(missing.api.default!({ context: {} }), { statusCode: 404 })
  assert.equal(missing.calls.includes('commit'), false)
  const legacy = archiveHarness({ ...archivePlan, sourceOssPath: 'codocs/reviews/7_Doc.md' }, { mirror: '# frozen copy' })
  await legacy.api.default!({ context: {} })
  assert.deepEqual(legacy.uploads, [['codocs/company/rules/x.md', '# frozen copy']])
})

test('quick publish copies the exact snapshot version for v2 items and the path for v1', async () => {
  const puts: Array<{ target: string, content: string, meta: Record<string, string> }> = []
  const reads: unknown[] = []
  let placed = false
  const client: QuickPublishStorage = {
    async head(path) {
      if (!placed) throw { status: 404 }
      assert.equal(path, 'codocs/company/rules/new.md')
      return { meta: { 'quick-publish-operation': 'op', 'quick-publish-source': 'source' }, res: { headers: { 'etag': 'e', 'content-length': String(body.length) } } }
    },
    async get(path, options) { reads.push([path, options?.versionId]); return { content: body, res: { headers: { etag: 'mirror-etag' } } } },
    async put(target, content, options) { placed = true; puts.push({ target, content: content.toString(), meta: options.meta }) }
  }
  const v2 = { sourceUuid: 'source', sourcePath: '', bodyRef: ref, title: 'A', newUuid: 'new', ossPath: 'codocs/company/rules/new.md' }
  await copyQuickPublishDocument(client, 'op', v2)
  assert.deepEqual(reads, [[ref.markdown.key, 'v-4']])
  assert.equal(puts[0]!.content, body.toString())
  assert.equal(puts[0]!.meta['quick-publish-source-etag'], `snapshot-g4-${sha}`)
  // A tampered object is never published.
  placed = false
  const tampered: QuickPublishStorage = { ...client, async get() { return { content: Buffer.from('# other'), res: { headers: {} } } }, async put() { assert.fail('must not publish unverifiable content') } }
  await assert.rejects(copyQuickPublishDocument(tampered, 'op', v2), { statusCode: 503 })
  // A v2 plan item without a usable body reference fails instead of reading a missing path.
  await assert.rejects(copyQuickPublishDocument(client, 'op', { ...v2, bodyRef: { generation: 0 } }), { statusCode: 503 })
  await assert.rejects(copyQuickPublishDocument(client, 'op', { ...v2, bodyRef: undefined }), { statusCode: 502 })
})

test('admin image cleanup never deletes an image a v2 body may reference, and reads the snapshot for the decision', async () => {
  const state = { downloads: 0, deleted: 0, doc: { uuid: 'doc', doc_type: 'department', oss_path: 'codocs/departments/D1/a.md', snapshot_generation: 2, snapshot_ref: ref } as Record<string, unknown>, content: '![](codocs/users/u/images/pic.png)', snapshotFails: false }
  const owner = load('../server/utils/adminImageDocuments.ts', {
    './codocsRuntime': { callCodocsTenantRuntime: async () => ({ items: [state.doc] }) },
    './documentBodyRef': documentBodyRef,
    './oss': {
      createRuntimeOSSClient: async () => ({ get: async () => { if (state.snapshotFails) throw new Error('offline'); return { content: Buffer.from(state.content) } } }),
      downloadDocument: async () => { state.downloads++; return '# stale mirror without the image' }
    }
  })
  const bodyOf = (text: string) => ({ ...ref, size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
  state.doc.snapshot_ref = bodyOf(state.content)
  const doc = await owner.findImageOwnerDocument!({}, 'codocs/departments/D1/a.md')
  assert.equal(await owner.readImageOwnerDocumentContent!({}, doc), state.content)
  assert.equal(state.downloads, 0, 'the stale mirror must not decide whether an image is referenced')
  state.snapshotFails = true
  await assert.rejects(owner.readImageOwnerDocumentContent!({}, doc), { statusCode: 503 })
  state.doc.snapshot_generation = 0
  assert.equal(await owner.readImageOwnerDocumentContent!({}, state.doc), '# stale mirror without the image')

  const deleteRoute = (v2: boolean, readFails: boolean) => load('../server/api/admin/images.delete.ts', {
    '~~/server/utils/adminImageDocuments': {
      findImageOwnerDocument: async () => ({ doc_type: 'department', oss_path: 'p', snapshot_generation: v2 ? 2 : 0 }),
      readImageOwnerDocumentContent: async () => { if (readFails) throw new Error('cannot read'); return '# no reference' }
    },
    '~~/server/utils/documentBodyRef': documentBodyRef,
    '~~/server/utils/oss': { deleteImage: async () => { state.deleted++ }, deleteImages: async () => { state.deleted++ }, getImageMetadata: async () => ({ 'doc-path': 'p' }) },
    '~~/server/utils/checkPermission': { requirePermission: async () => {} },
    '~~/server/utils/ossImagePath': { normalizeCodocsUserImageObjectPath: (path: string) => path }
  }, {
    defineEventHandler: (fn: Fn) => fn,
    readBody: async () => ({ paths: ['codocs/users/u/images/pic.png'] }),
    createError: ({ statusCode, message }: { statusCode: number, message: string }) => failure(statusCode, message),
    console: { error: () => {} }
  })
  await assert.rejects(deleteRoute(true, true).default!({ context: {} }), { statusCode: 503 })
  assert.equal(state.deleted, 0)
  // v1 keeps the old behavior: unreadable content is treated as an orphan.
  await deleteRoute(false, true).default!({ context: {} })
  assert.equal(state.deleted, 1)
})
