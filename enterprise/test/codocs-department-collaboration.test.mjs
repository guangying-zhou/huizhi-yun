import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const external = ['h3', '@hzy/foundation/*', '*/codocs/server/utils/oss', '*/codocs/server/utils/yjsMarkdownRecovery']
const bundle = entry => buildSync({
  entryPoints: [new URL(`../server/utils/${entry}`, import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false, external
}).outputFiles[0].text
const departmentCode = bundle('enterpriseCodocsDepartmentCollaboration.ts')
const contentCode = bundle('enterpriseCodocsDocumentContent.ts')

const sha = value => createHash('sha256').update(value).digest('hex')
const user = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const UUID = '0a1b2c3d-1111-4222-8333-444455556666'
const prefix = 'codocs/snapshots/h/doc/k/'
const flagKeys = ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2']

function load(code, state) {
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'h3') return {
      createError: details => Object.assign(new Error(details.message), details),
      getRequestURL: event => new URL(event.url),
      getQuery: event => Object.fromEntries(new URL(event.url).searchParams),
      getRouterParam: event => event.uuid,
      getHeader: (event, header) => event.headers[header],
      setHeader: (event, header, value) => { event.headers[header] = value }
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => user,
      prepareEnterpriseRuntime: async (_event, operation) => { state.calls.push({ prepare: operation }) },
      enterpriseRuntimePermitExpiresAt: () => 1000,
      callEnterpriseRuntime: async (_event, operation, request, options) => {
        state.calls.push({ operation, request, options })
        return state.runtime(operation, request, options)
      }
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => {
        state.calls.push({ authorization: true })
        if (state.authorizationUnavailable) throw Object.assign(new Error('Console unavailable'), { statusCode: 503 })
        return { resources: { departments: state.person ?? ['view', 'edit'] }, actionPolicies: {} }
      }
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return {
      authorizationResourcesAllow: (resources, resource, action) => (resources[resource] || []).includes(action)
    }
    if (name === '@hzy/foundation/server/utils/objectStorageVersion') return { objectStorageVersionId: headers => headers['x-oss-version-id'] }
    if (name.endsWith('/codocs/server/utils/oss')) return {
      createRuntimeOSSClient: async () => state.storage,
      downloadDocument: async (path, type) => {
        state.downloads.push([path, type])
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

function storage(state) {
  return {
    puts: [],
    objects: new Map(),
    async put(key, bytes, options) {
      const version = `v${this.puts.length + 1}`
      this.puts.push({ key, bytes: Buffer.from(bytes), options })
      this.objects.set(`${key}@${version}`, Buffer.from(bytes))
      return { res: { headers: { 'x-oss-version-id': version } } }
    },
    async head(key) {
      state.heads.push(key)
      if (state.yjsHeadError) throw state.yjsHeadError
      if (state.yjsModified === undefined) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { res: { headers: { 'last-modified': state.yjsModified } } }
    },
    async get(key, { versionId }) {
      const content = this.objects.get(`${key}@${versionId}`)
      if (!content) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { content }
    }
  }
}

const hour = 3_600_000
function fixture(overrides = {}) {
  const state = {
    calls: [], downloads: [], heads: [], legacy: '# v1 body\n', head: { generation: 0, epoch: 7 },
    doc: { uuid: UUID, doc_type: 'department', dept_code: 'D1', status: 1, project_code: '', readonly_flag: 0, oss_path: 'codocs/departments/D1/a.md', updated_at: new Date(Date.now() - hour).toISOString() },
    ...overrides
  }
  state.storage = storage(state)
  state.runtime = async (operation) => {
    if (operation.endsWith('-view')) return { success: true, data: state.doc }
    if (operation.endsWith('snapshot-read')) return { success: true, data: state.head }
    if (operation.endsWith('snapshot-prepare')) return { success: true, data: { prefix, generation: 0, replayed: false } }
    if (operation.endsWith('snapshot-publish')) return { success: true, data: { generation: 1, replayed: false } }
    if (operation.endsWith('collaboration-open')) return { success: true, data: { sessionId: 'session-a', ticket: 'a'.repeat(64), expiresAt: 'later', generation: 1, epoch: 7 } }
    throw new Error(operation)
  }
  return state
}

function event(overrides = {}) {
  return { uuid: UUID, url: `https://host.test/codocs/api/departments/documents/${UUID}/collaboration?dept_code=D1`, headers: {}, ...overrides }
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
const operations = state => state.calls.filter(call => call.operation).map(call => call.operation.replace('codocs.department-documents-', ''))

test('all three switches must be on; otherwise nothing reaches Runtime', async () => {
  for (const flags of [[false, true, true], [true, false, true], [true, true, false], [false, false, false]]) {
    const state = fixture()
    const module = load(departmentCode, state)
    await withFlags(flags, async () => {
      await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), { statusCode: 404 })
      await assert.rejects(module.enterpriseCodocsDepartmentCollaborationConvert(event()), { statusCode: 404 })
      assert.equal(module.codocsDepartmentCollaborationV2Enabled(), false)
    })
    assert.deepEqual(state.calls, [], JSON.stringify(flags))
  }
})

test('open: forged department, owner or type inputs are rejected before any Runtime call', async () => {
  const state = fixture()
  const module = load(departmentCode, state)
  const base = 'https://host.test/codocs/api/departments/documents/x/collaboration'
  await withFlags(on, async () => {
    for (const url of [
      `${base}`, `${base}?dept_code=D1&owner_uid=victim`, `${base}?dept_code=D1&doc_type=private`, `${base}?dept_code=D1&role=manager`,
      `${base}?dept_code=D1&dept_code=D2`, `${base}?dept_code=../D1`, `${base}?dept_code=`
    ]) await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event({ url })), { statusCode: 400 }, url)
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event({ uuid: 'not-a-uuid' })), { statusCode: 400 })
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event({ headers: { 'content-length': '2' } })), { statusCode: 400 })
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event({ headers: { 'transfer-encoding': 'chunked' } })), { statusCode: 400 })
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationConvert(event({ url: `${base}?dept_code=D1&owner_uid=victim` })), { statusCode: 400 })
  })
  assert.deepEqual(state.calls, [])
})

test('open: departments:edit is required, outages stay 503, and Runtime sees no relation facts', async () => {
  const state = fixture()
  const module = load(departmentCode, state)
  await withFlags(on, async () => {
    state.person = ['view']
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), { statusCode: 403 })
    assert.deepEqual(operations(state), [], 'a person without departments:edit never reaches Runtime')
    state.authorizationUnavailable = true
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), { statusCode: 503 })
    assert.deepEqual(operations(state), [])
    state.authorizationUnavailable = false
    state.person = ['view', 'edit']

    const e = event()
    const opened = await module.enterpriseCodocsDepartmentCollaborationOpen(e)
    assert.deepEqual(opened, { success: true, data: { token: `v2.${'a'.repeat(64)}`, sessionId: 'session-a', expiresAt: 'later', generation: 1 } })
    assert.equal(e.headers['Cache-Control'], 'no-store')
    const call = state.calls.find(item => item.operation)
    assert.equal(call.operation, 'codocs.department-documents-collaboration-open')
    assert.deepEqual(Object.keys(call.request).sort(), ['authorization', 'code', 'deployment', 'subId', 'tenant'])
    assert.equal(call.request.code, 'D1')
    assert.equal(call.request.subId, UUID)
    assert.deepEqual(call.request.authorization, { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: 'department-documents', action: 'edit', expiresAt: 1000 })
    assert.equal(call.options, undefined, 'the session is keyed by the document; the ticket is deliberately not replayable')
  })
})

test('open: Runtime refusals propagate and malformed tickets are not released', async () => {
  const state = fixture()
  const module = load(departmentCode, state)
  await withFlags(on, async () => {
    for (const [statusCode, code] of [[403, 'department_writer_required'], [403, 'department_document_write_denied'], [409, 'document_not_on_snapshot_v2'], [409, 'collaboration_writer_limit_reached'], [429, 'collaboration_open_rate_limited']]) {
      state.runtime = async () => {
        throw Object.assign(new Error('runtime'), { statusCode, data: { code } })
      }
      await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), error => error.statusCode === statusCode && error.data.code === code)
    }
    state.runtime = async () => ({ success: true, data: { sessionId: 'session-a', ticket: 'short' } })
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), { statusCode: 503 })
    state.runtime = async () => ({ success: false, data: { sessionId: 'session-a', ticket: 'a'.repeat(64) } })
    await assert.rejects(module.enterpriseCodocsDepartmentCollaborationOpen(event()), { statusCode: 503 })
  })
})

test('convert: only live Markdown department documents are converted', async () => {
  const cases = [
    { doc_type: 'private' }, { doc_type: 'project' }, { doc_type: 'company' }, { status: 2 }, { status: 0 }, { dept_code: 'D2' }, { project_code: 'P1' }, { readonly_flag: 1 },
    { oss_path: 'codocs/departments/D1/weekly-reports/2026/w1.md' }, { oss_path: 'codocs/departments/D1/a.docx' }, { oss_path: 'recycle.bin/codocs/departments/D1/a.md' }, { oss_path: '' }, { uuid: 'other' }
  ]
  for (const change of cases) {
    const state = fixture({ doc: { ...fixture().doc, ...change } })
    const module = load(departmentCode, state)
    await withFlags(on, async () => {
      await assert.rejects(module.enterpriseCodocsDepartmentCollaborationConvert(event()), error => [409, 503].includes(error.statusCode), JSON.stringify(change))
    })
    assert.ok(!operations(state).some(name => name.startsWith('snapshot-')), `no snapshot work for ${JSON.stringify(change)}`)
    assert.equal(state.downloads.length, 0)
    if (change.uuid === undefined) {
      await withFlags(on, () => assert.rejects(module.enterpriseCodocsDepartmentCollaborationConvert(event()), { statusCode: 409, data: { code: 'department_document_not_convertible' } }))
    }
  }
})

test('convert: refuses while a v1 room looks active and fails closed when that cannot be told', async () => {
  const recent = new Date(Date.now() - 10_000).toUTCString()
  const old = new Date(Date.now() - hour).toUTCString()
  for (const [label, overrides, expected] of [
    ['fresh updated_at', { doc: { ...fixture().doc, updated_at: new Date(Date.now() - 5_000).toISOString() } }, { statusCode: 409, data: { code: 'document_v1_collaboration_active' } }],
    ['unparseable updated_at', { doc: { ...fixture().doc, updated_at: 'yesterday-ish' } }, { statusCode: 409, data: { code: 'document_v1_collaboration_active' } }],
    ['fresh .yjs sidecar', { yjsModified: recent }, { statusCode: 409, data: { code: 'document_v1_collaboration_active' } }],
    ['unparseable .yjs freshness', { yjsModified: 'not-a-date' }, { statusCode: 409, data: { code: 'document_v1_collaboration_active' } }],
    ['sidecar lookup fails', { yjsHeadError: Object.assign(new Error('boom'), { statusCode: 500 }) }, { statusCode: 503 }]
  ]) {
    const state = fixture(overrides)
    const module = load(departmentCode, state)
    await withFlags(on, () => assert.rejects(module.enterpriseCodocsDepartmentCollaborationConvert(event()), expected, label))
    assert.ok(!operations(state).some(name => name === 'snapshot-prepare' || name === 'snapshot-publish'), label)
    assert.equal(state.storage.puts.length, 0, label)
  }
  const state = fixture({ yjsModified: old })
  const module = load(departmentCode, state)
  assert.equal(state.heads.length, 0)
  const result = await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  assert.equal(result.data.converted, true)
  assert.deepEqual(state.heads, ['codocs/departments/D1/a.yjs'], 'the sidecar next to the Markdown is the presence proxy')
})

test('convert: publishes the current Markdown as generation 1 by compare-and-swap', async () => {
  const state = fixture()
  const module = load(departmentCode, state)
  const first = await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  assert.deepEqual(first, { success: true, data: { converted: true, generation: 1, epoch: 7, replayed: false } })
  assert.deepEqual(operations(state), ['view', 'snapshot-read', 'snapshot-prepare', 'snapshot-publish'])
  assert.deepEqual(state.downloads, [['codocs/departments/D1/a.md', 'department']])
  const [prepare, publish] = ['snapshot-prepare', 'snapshot-publish'].map(name => state.calls.find(call => call.operation?.endsWith(name)))
  const bytes = Buffer.from('# v1 body\n')
  assert.deepEqual(prepare.request.payload, { generation: 0, epoch: 7, markdownSha256: sha(bytes), markdownSize: bytes.length })
  assert.equal(prepare.request.code, 'D1')
  assert.equal(prepare.request.subId, UUID)
  assert.equal(prepare.request.authorization.resource, 'department-documents')
  assert.equal(prepare.request.authorization.action, 'edit')
  assert.match(prepare.options.idempotencyKey, /^dept-convert:[a-f0-9]{64}$/)
  assert.equal(publish.options.idempotencyKey, prepare.options.idempotencyKey)
  const [put] = state.storage.puts
  assert.equal(put.options.forbidOverwrite, true, 'the candidate is written once, request-level')
  assert.deepEqual(publish.request.payload.objects, { markdown: { key: put.key, version: 'v1' } })
  assert.equal(put.bytes.toString(), '# v1 body\n')

  // The same user intent repeats the same command key; another body is another intent.
  await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  const keys = state.calls.filter(call => call.operation?.endsWith('snapshot-prepare')).map(call => call.options.idempotencyKey)
  assert.equal(keys[0], keys[1])
  state.legacy = '# edited\n'
  await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  const later = state.calls.filter(call => call.operation?.endsWith('snapshot-prepare')).map(call => call.options.idempotencyKey)
  assert.notEqual(later[2], keys[0])
})

test('convert: a document that is already v2 is not converted again, and reading never converts', async () => {
  const body = Buffer.from('# v2\n')
  const state = fixture({ head: { generation: 4, epoch: 2, objects: { markdown: { key: `${prefix}c/body.md`, version: 'v1' } }, markdownSize: body.length, markdownSha256: sha(body) } })
  const module = load(departmentCode, state)
  const result = await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  assert.deepEqual(result, { success: true, data: { converted: true, generation: 4, epoch: 2, replayed: true } })
  assert.ok(!operations(state).some(name => name === 'snapshot-prepare' || name === 'snapshot-publish'))
  assert.equal(state.downloads.length, 0)

  // Reading a still-v1 department document (the content path) never reaches prepare/publish.
  const reading = fixture()
  const content = load(contentCode, reading)
  await withFlags(on, () => content.withEnterpriseCodocsDocumentContent({}, { success: true, data: reading.doc }, UUID, false))
  assert.deepEqual(operations(reading), ['snapshot-read'])
})

test('convert: losing the generation 0 -> 1 race joins the winner; other failures stay failures', async () => {
  const body = Buffer.from('# winner\n')
  const state = fixture()
  let reads = 0
  state.runtime = async (operation) => {
    if (operation.endsWith('-view')) return { success: true, data: state.doc }
    if (operation.endsWith('snapshot-read')) {
      reads += 1
      return { success: true, data: reads === 1 ? { generation: 0, epoch: 7 } : { generation: 1, epoch: 7, objects: { markdown: { key: `${prefix}w/body.md`, version: 'v1' } }, markdownSize: body.length, markdownSha256: sha(body) } }
    }
    if (operation.endsWith('snapshot-prepare')) throw Object.assign(new Error('conflict'), { statusCode: 409, data: { code: 'snapshot_generation_conflict' } })
    throw new Error(operation)
  }
  const module = load(departmentCode, state)
  const result = await withFlags(on, () => module.enterpriseCodocsDepartmentCollaborationConvert(event()))
  assert.deepEqual(result, { success: true, data: { converted: true, generation: 1, epoch: 7, replayed: true } })

  const stuck = fixture()
  stuck.runtime = async (operation) => {
    if (operation.endsWith('-view')) return { success: true, data: stuck.doc }
    if (operation.endsWith('snapshot-read')) return { success: true, data: { generation: 0, epoch: 7 } }
    throw Object.assign(new Error('conflict'), { statusCode: 409, data: { code: 'snapshot_generation_conflict' } })
  }
  await withFlags(on, () => assert.rejects(load(departmentCode, stuck).enterpriseCodocsDepartmentCollaborationConvert(event()), { statusCode: 409 }))

  const denied = fixture()
  denied.runtime = async (operation) => {
    if (operation.endsWith('-view')) return { success: true, data: denied.doc }
    if (operation.endsWith('snapshot-read')) return { success: true, data: { generation: 0, epoch: 7 } }
    throw Object.assign(new Error('denied'), { statusCode: 403, data: { code: 'department_writer_required' } })
  }
  await withFlags(on, () => assert.rejects(load(departmentCode, denied).enterpriseCodocsDepartmentCollaborationConvert(event()), error => error.statusCode === 403 && error.data.code === 'department_writer_required'))
  assert.equal(denied.storage.puts.length, 0)
})

test('convert: requires departments:edit and a payload within the size cap', async () => {
  const state = fixture({ person: ['view'] })
  await withFlags(on, () => assert.rejects(load(departmentCode, state).enterpriseCodocsDepartmentCollaborationConvert(event()), { statusCode: 403 }))
  assert.deepEqual(operations(state), [])
  const big = fixture({ legacy: 'x'.repeat(10 * 1024 * 1024 + 1) })
  await withFlags(on, () => assert.rejects(load(departmentCode, big).enterpriseCodocsDepartmentCollaborationConvert(event()), { statusCode: 413 }))
  assert.equal(big.storage.puts.length, 0)
})

test('snapshot reads verify the published length and digest and never fall back to the mirror', async () => {
  const body = Buffer.from('# published\n')
  const published = { generation: 3, epoch: 1, objects: { markdown: { key: `${prefix}c/body.md`, version: 'v1' } }, markdownSize: body.length, markdownSha256: sha(body) }
  const state = fixture({ head: published, legacy: '# stale mirror\n' })
  await state.storage.put(`${prefix}c/body.md`, body)
  const content = load(contentCode, state)
  const read = await withFlags(on, () => content.withEnterpriseCodocsDocumentContent({}, { success: true, data: state.doc }, UUID, false, 'view'))
  assert.equal(read.data.content, '# published\n')
  assert.equal(read.data.snapshot_generation, 3)
  assert.equal(state.downloads.length, 0)
  assert.equal(state.storage.puts.length, 1, 'a reader writes nothing (no mirror repair)')

  for (const tampered of [{ markdownSha256: sha('other') }, { markdownSize: body.length + 1 }]) {
    state.head = { ...published, ...tampered }
    await withFlags(on, () => assert.rejects(content.withEnterpriseCodocsDocumentContent({}, { success: true, data: state.doc }, UUID, false), { statusCode: 503 }))
  }
  state.head = { ...published, objects: { markdown: { key: `${prefix}c/body.md`, version: 'missing' } } }
  await withFlags(on, () => assert.rejects(content.withEnterpriseCodocsDocumentContent({}, { success: true, data: state.doc }, UUID, false), { statusCode: 503 }))
  assert.equal(state.downloads.length, 0, 'a failed verification never serves the derived copy')

  // The head is requested with the caller's own permission, not a wider one.
  state.person = ['export']
  state.head = published
  await withFlags(on, () => content.withEnterpriseCodocsDocumentContent({}, { success: true, data: state.doc }, UUID, false, 'export'))
  state.person = ['view']
  await withFlags(on, () => assert.rejects(content.withEnterpriseCodocsDocumentContent({}, { success: true, data: state.doc }, UUID, false, 'export'), { statusCode: 403 }))
})
