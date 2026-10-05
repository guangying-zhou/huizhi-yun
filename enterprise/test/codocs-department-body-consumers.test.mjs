import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

// Host-side body consumers of a department document that may have been
// converted for collaboration: detail view, download, open-department read and
// company quick publish (docs/Codocs-Collaboration-Body-Consumers-Inventory.md).

const external = ['h3', '@hzy/foundation/*', '*/codocs/server/utils/oss', '*/codocs/server/utils/yjsMarkdownRecovery']
const bundle = entry => buildSync({
  entryPoints: [new URL(`../server/utils/${entry}`, import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false, external
}).outputFiles[0].text
const code = {
  documents: bundle('enterpriseCodocsDepartmentDocuments.ts'),
  open: bundle('enterpriseCodocsCompanyOpenDocs.ts'),
  publish: bundle('enterpriseCodocsCompanyQuickPublish.ts')
}

const sha = value => createHash('sha256').update(value).digest('hex')
const UUID = '0a1b2c3d-1111-4222-8333-444455556666'
const user = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const prefix = 'codocs/snapshots/h/doc/k/'
const flagKeys = ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2']

function load(entry, state) {
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code[entry])((name) => {
    if (name === 'h3') return {
      createError: details => Object.assign(new Error(details.message), details),
      getRequestURL: event => new URL(event.url),
      getQuery: event => Object.fromEntries(new URL(event.url).searchParams),
      getRouterParam: event => event.uuid,
      getHeader: () => undefined,
      readBody: async () => ({}),
      setHeader: (event, header, value) => { event.headers[header] = value }
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => user,
      prepareEnterpriseRuntime: async () => {},
      enterpriseRuntimePermitExpiresAt: () => 1000,
      callEnterpriseRuntime: async (_event, operation, request, options) => {
        state.calls.push({ operation, request, options })
        return state.runtime(operation, request, options)
      }
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => ({ resources: state.person ?? { departments: ['view', 'export'], company: ['view'] }, actionPolicies: {} })
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return {
      authorizationResourcesAllow: (resources, resource, action) => (resources[resource] || []).includes(action)
    }
    if (name === '@hzy/foundation/server/utils/directoryApi') return { fetchConsoleDirectoryApi: async () => ({ code: 0 }) }
    if (name === '@hzy/foundation/server/utils/objectStorageVersion') return { objectStorageVersionId: headers => headers['x-oss-version-id'] }
    if (name.endsWith('/codocs/server/utils/oss')) return {
      createRuntimeOSSClient: async () => state.storage,
      downloadDocument: async (path) => {
        state.downloads.push(path)
        return state.legacy
      }
    }
    if (name.endsWith('/codocs/server/utils/yjsMarkdownRecovery')) return {
      hasMeaningfulMarkdownContent: value => String(value ?? '').trim().length > 0,
      recoverMarkdownFromYjsSnapshot: async () => ''
    }
    return require(name)
  }, module, module.exports)
  return module.exports
}

function storage() {
  return {
    puts: [],
    objects: new Map(),
    conflictOnPut: false,
    failPut: false,
    async put(key, bytes, options) {
      if (this.failPut) throw new Error('storage down')
      if (this.conflictOnPut) throw Object.assign(new Error('exists'), { statusCode: 412 })
      const version = `v${this.puts.length + 1}`
      this.puts.push({ key, bytes: Buffer.from(bytes), options })
      this.objects.set(`${key}@${version}`, Buffer.from(bytes))
      return { res: { headers: { 'x-oss-version-id': version } } }
    },
    async get(key, { versionId }) {
      const content = this.objects.get(`${key}@${versionId}`)
      if (!content) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { content }
    }
  }
}

function fixture(overrides = {}) {
  const body = Buffer.from('# published\n')
  const state = {
    calls: [], downloads: [], legacy: '# stale mirror\n', storage: storage(),
    doc: { uuid: UUID, id: 5, doc_type: 'department', dept_code: 'D1', title: 'Team', status: 1, project_code: '', readonly: false, readonly_flag: 0, oss_path: 'codocs/departments/D1/a.md', updated_at: 'now', star_flag: 1, secret: 'x' },
    access: { role: 'member', canRead: true, canWrite: true, canManage: false },
    head: { generation: 2, epoch: 1, objects: { markdown: { key: `${prefix}c/body.md`, version: 'v1' } }, markdownSize: body.length, markdownSha256: sha(body) },
    ...overrides
  }
  state.storage.objects.set(`${prefix}c/body.md@v1`, body)
  state.runtime = async (operation) => {
    if (operation === 'codocs.department-documents-view' || operation === 'codocs.department-documents-download') return { success: true, data: state.doc }
    if (operation === 'codocs.department-access-resolve') return { success: true, data: state.access }
    if (operation === 'codocs.department-documents-snapshot-read') return { success: true, data: state.head }
    throw new Error(operation)
  }
  return state
}

async function withFlags(values, action) {
  const before = flagKeys.map(key => process.env[key])
  flagKeys.forEach((key, index) => {
    if (values[index]) process.env[key] = 'true'
    else delete process.env[key]
  })
  try {
    return await action()
  } finally {
    flagKeys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key]
      else process.env[key] = before[index]
    })
  }
}
const on = [true, true, true]
const event = (extra = {}) => ({ uuid: UUID, url: `https://host.test/codocs/api/departments/documents/${UUID}?dept_code=D1`, headers: {}, ...extra })

test('detail view reads the exact published body, projects fields and hints who may collaborate', async () => {
  const state = fixture()
  const module = load('documents', state)
  const e = event()
  const view = await withFlags(on, () => module.viewEnterpriseDepartmentDocument(e))
  assert.equal(e.headers['Cache-Control'], 'no-store')
  assert.equal(view.data.content, '# published\n')
  assert.equal(view.data.snapshot_generation, 2)
  assert.equal(view.data.snapshot_epoch, 1)
  assert.equal(view.data.oss_path, undefined, 'internal columns never reach the browser')
  assert.equal(view.data.star_flag, undefined)
  assert.equal(view.data.secret, undefined)
  assert.deepEqual(view.data.department_collaboration, { can_edit: true })
  assert.equal(state.downloads.length, 0, 'the derived copy is not read once a snapshot is published')

  const hints = async (access, doc) => {
    const item = fixture({ access, doc: { ...fixture().doc, ...doc } })
    const result = await withFlags(on, () => load('documents', item).viewEnterpriseDepartmentDocument(event()))
    return result.data.department_collaboration.can_edit
  }
  const member = { role: 'member', canRead: true, canWrite: true, canManage: false }
  assert.equal(await hints(member, { readonly: false }), true, 'owner or write sharee')
  assert.equal(await hints(member, { readonly: true }), false, 'a member who is neither owner nor write sharee')
  assert.equal(await hints({ ...member, canManage: true }, { readonly: true }), true, 'a manager may edit others documents')
  assert.equal(await hints({ ...member, canWrite: false }, { readonly: false }), false, 'leader and parent relations only read')
  assert.equal(await hints({ ...member, canManage: true }, { readonly_flag: 1, readonly: true }), false, 'a read-only document has no session')
  assert.equal(await hints({ ...member, canManage: true }, { status: 2 }), false, 'archived copies have no session')
  assert.equal(await hints({ ...member, canManage: true }, { project_code: 'P1' }), false)
})

test('detail view keeps the v1 body and offers no hint while the switch is off; validates the response', async () => {
  const state = fixture()
  const module = load('documents', state)
  const off = await withFlags([true, true, false], () => module.viewEnterpriseDepartmentDocument(event()))
  assert.equal(off.data.content, '# stale mirror\n')
  assert.equal(off.data.department_collaboration, undefined)
  assert.ok(!state.calls.some(call => call.operation.includes('snapshot') || call.operation.includes('access-resolve')))

  state.person = { departments: [] }
  await withFlags(on, () => assert.rejects(module.viewEnterpriseDepartmentDocument(event()), { statusCode: 403 }))
  state.person = undefined
  for (const doc of [{ ...state.doc, dept_code: 'D2' }, { ...state.doc, doc_type: 'private' }, { ...state.doc, uuid: 'other' }]) {
    state.doc = doc
    await withFlags(on, () => assert.rejects(module.viewEnterpriseDepartmentDocument(event()), { statusCode: 503 }))
  }
  for (const bad of [event({ uuid: 'nope' }), event({ url: `https://host.test/x?dept_code=D1&owner_uid=victim` }), event({ url: 'https://host.test/x' })]) {
    await withFlags(on, () => assert.rejects(module.viewEnterpriseDepartmentDocument(bad), { statusCode: 400 }))
  }
})

test('download serves the published snapshot and needs no mirror path once converted', async () => {
  const state = fixture({ doc: { ...fixture().doc, oss_path: '' } })
  const module = load('documents', state)
  const e = event({ url: `https://host.test/x?dept_code=D1` })
  const bytes = await withFlags(on, () => module.downloadEnterpriseDepartmentDocument(e))
  assert.equal(bytes.toString(), '# published\n')
  assert.match(e.headers['Content-Disposition'], /attachment/)
  const head = state.calls.find(call => call.operation.endsWith('snapshot-read'))
  assert.equal(head.request.code, 'D1')
  assert.equal(head.request.subId, UUID)

  const v1 = fixture({ doc: { ...fixture().doc, oss_path: '' }, head: { generation: 0, epoch: 1 } })
  await withFlags(on, () => assert.rejects(load('documents', v1).downloadEnterpriseDepartmentDocument(e), { statusCode: 404 }))
})

test('open department documents: v1 reads its path, a converted one only through the Runtime reference', async () => {
  const doc = { uuid: UUID, title: 'Open', folder_id: 3, dept_code: 'D1', doc_type: 'department', oss_path: 'codocs/departments/D1/a.md', snapshot_generation: 0 }
  const listed = { folders: [{ id: 3, dept_code: 'D1', name: 'Public' }], documents: [doc] }
  const state = fixture({ legacy: '# stale mirror\n' })
  state.runtime = async () => ({ success: true, data: listed })
  const module = load('open', state)
  state.person = { company: ['view'] }

  const off = await withFlags([true, true, false], () => module.viewEnterpriseOpenDepartmentDoc(event()))
  assert.equal(off.data.content, '# stale mirror\n', 'unchanged while the switch is off')
  const v1 = await withFlags(on, () => module.viewEnterpriseOpenDepartmentDoc(event()))
  assert.equal(v1.data.content, '# stale mirror\n', 'Runtime says generation 0: the document still reads its own path')

  const body = Buffer.from('# published\n')
  const ref = { generation: 3, epoch: 1, markdown: { key: `${prefix}c/body.md`, version: 'v1' }, size: body.length, sha256: sha(body) }
  state.downloads.length = 0
  listed.documents = [{ ...doc, snapshot_generation: 3 }]
  await withFlags(on, () => assert.rejects(module.viewEnterpriseOpenDepartmentDoc(event()), { statusCode: 503, data: { code: 'enterprise_document_body_ref_required' } }))
  listed.documents = [{ ...doc, snapshot_generation: undefined }]
  await withFlags(on, () => assert.rejects(module.viewEnterpriseOpenDepartmentDoc(event()), { statusCode: 503, data: { code: 'enterprise_document_body_ref_required' } }), 'an unannotated response cannot prove the document is v1')
  assert.equal(state.downloads.length, 0, 'never guesses from the mirror')

  for (const field of ['snapshot_ref', 'body_ref']) {
    listed.documents = [{ ...doc, snapshot_generation: 3, [field]: ref }]
    const viaReference = await withFlags(on, () => module.viewEnterpriseOpenDepartmentDoc(event()))
    assert.equal(viaReference.data.content, '# published\n', field)
    assert.equal(viaReference.data.readonly_flag, 1)
  }
  assert.ok(!state.calls.some(call => call.operation.includes('snapshot-read')), 'the reader is outside the department: no department snapshot call')

  listed.documents = [{ ...doc, snapshot_generation: 3, snapshot_ref: { ...ref, sha256: sha('tampered') } }]
  await withFlags(on, () => assert.rejects(module.viewEnterpriseOpenDepartmentDoc(event()), { statusCode: 503 }))
})

test('quick publish copies the exact published version, not a stale mirror', async () => {
  const body = Buffer.from('# published\n')
  const ref = { generation: 3, epoch: 1, markdown: { key: `${prefix}c/body.md`, version: 'v1' }, size: body.length, sha256: sha(body) }
  const item = { sourceUuid: UUID, sourcePath: 'codocs/departments/D1/a.md', title: 'Team', newUuid: 'n1', ossPath: 'codocs/company/x/a.md' }
  const state = fixture()
  const module = load('publish', state)
  const client = state.storage

  // v1 (no reference, a path) copies from its own path whatever the switches say.
  for (const flags of [[true, true, false], on]) assert.deepEqual(await withFlags(flags, () => module.exactQuickPublishSource({}, client, item)), item)
  assert.equal(client.puts.length, 0)
  // Neither a path nor a reference cannot be copied.
  await withFlags(on, () => assert.rejects(module.exactQuickPublishSource({}, client, { ...item, sourcePath: '' }), { statusCode: 503, data: { code: 'enterprise_document_body_ref_required' } }))

  // v2: Runtime withholds the mirror path and sends the exact version.
  const v2 = { ...item, sourcePath: '', bodyRef: ref }
  const staged = await withFlags(on, () => module.exactQuickPublishSource({}, client, v2))
  const stagedPath = `codocs/copy-staging/quick-publish/${sha(body)}.md`
  assert.deepEqual(staged, { ...item, sourcePath: stagedPath })
  assert.equal(staged.bodyRef, undefined)
  const put = client.puts.find(entry => entry.key === stagedPath)
  assert.equal(put.bytes.toString(), '# published\n')
  assert.equal(put.options.forbidOverwrite, true)

  client.conflictOnPut = true
  assert.deepEqual(await withFlags(on, () => module.exactQuickPublishSource({}, client, v2)), { ...item, sourcePath: stagedPath }, 'content-addressed: an existing object holds the same bytes')
  client.conflictOnPut = false
  client.failPut = true
  await withFlags(on, () => assert.rejects(module.exactQuickPublishSource({}, client, v2), { statusCode: 503 }))
  client.failPut = false
  await withFlags(on, () => assert.rejects(module.exactQuickPublishSource({}, client, { ...v2, bodyRef: { ...ref, sha256: sha('other') } }), { statusCode: 503 }), 'a digest mismatch is never copied')
  await withFlags(on, () => assert.rejects(module.exactQuickPublishSource({}, client, { ...v2, bodyRef: { ...ref, size: body.length + 1 } }), { statusCode: 503 }))
  await withFlags(on, () => assert.rejects(module.exactQuickPublishSource({}, client, { ...v2, bodyRef: { generation: 3 } }), { statusCode: 503 }))
})
