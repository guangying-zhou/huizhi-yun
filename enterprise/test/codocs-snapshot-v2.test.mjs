import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'

const code = buildSync({
  entryPoints: [new URL('../server/utils/enterpriseCodocsSnapshot.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['h3', '@hzy/foundation/*', '*/codocs/server/utils/oss']
}).outputFiles[0].text

const sha = value => createHash('sha256').update(value).digest('hex')
const user = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const prefix = 'codocs/snapshots/h/doc-1/k/'

function load(state) {
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => user,
      prepareEnterpriseRuntime: async () => true,
      enterpriseRuntimePermitExpiresAt: () => Date.now() + 15000,
      callEnterpriseRuntime: async (_event, operation, request, options) => state.runtime(operation, request, options)
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => ({ resources: state.resources ?? { documents: ['view', 'edit'] }, actionPolicies: {} })
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return {
      authorizationResourcesAllow: (resources, resource, action) => (resources[resource] || []).includes(action)
    }
    if (name === '@hzy/foundation/server/utils/objectStorageVersion') return { objectStorageVersionId: headers => headers['x-oss-version-id'] }
    if (name.endsWith('/codocs/server/utils/oss')) return { createRuntimeOSSClient: async () => state.storage }
    return require(name)
  }, module, module.exports)
  return module.exports
}

function storage(state) {
  return {
    puts: [],
    objects: new Map(),
    async put(key, bytes, options) {
      if (state.failPut) throw new Error('down')
      const version = `v${this.puts.length + 1}`
      this.puts.push({ key, bytes: Buffer.from(bytes), options })
      this.objects.set(`${key}@${version}`, Buffer.from(bytes))
      return { res: { headers: { 'x-oss-version-id': version } } }
    },
    async head(key) {
      const last = [...this.puts].reverse().find(put => put.key === key)
      if (!last) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { meta: last.options?.meta || {} }
    },
    async get(key, { versionId }) {
      const content = this.objects.get(`${key}@${versionId}`)
      if (!content) throw Object.assign(new Error('missing'), { statusCode: 404 })
      return { content }
    }
  }
}

test('v2 is off unless the Host switch is on', () => {
  const original = process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
  try {
    delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    assert.equal(load({}).codocsSnapshotV2Enabled(), false)
    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = '1'
    assert.equal(load({}).codocsSnapshotV2Enabled(), false, 'only the exact value "true" enables it')
    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = 'true'
    assert.equal(load({}).codocsSnapshotV2Enabled(), true)
  } finally {
    if (original === undefined) delete process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2
    else process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = original
  }
})

test('save uploads once into a fresh attempt key and publishes the exact version under the same key', async () => {
  const bytes = Buffer.from('# hello\n')
  const calls = []
  const state = { enabled: true }
  state.storage = storage(state)
  state.runtime = async (operation, request, options) => {
    calls.push({ operation, request, options })
    if (operation.endsWith('snapshot-read')) return { success: true, data: { generation: 4, epoch: 2, objects: { markdown: { key: `${prefix}old/body.md`, version: 'v0' } }, markdownSize: 3, markdownSha256: sha('old') } }
    if (operation.endsWith('snapshot-prepare')) return { success: true, data: { prefix, generation: 4, replayed: false } }
    if (operation.endsWith('snapshot-publish')) return { success: true, data: { generation: 5, replayed: false } }
    throw new Error(operation)
  }
  const result = await load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 4, expectedEpoch: 2 })
  assert.deepEqual(result, { generation: 5, replayed: false })
  const [put] = state.storage.puts
  assert.match(put.key, /^codocs\/snapshots\/h\/doc-1\/k\/[a-f0-9]{32}\/body\.md$/)
  assert.equal(put.options.forbidOverwrite, true)
  const prepare = calls.find(call => call.operation.endsWith('snapshot-prepare'))
  const publish = calls.find(call => call.operation.endsWith('snapshot-publish'))
  const command = { generation: 4, epoch: 2, markdownSha256: sha(bytes), markdownSize: bytes.length }
  assert.deepEqual(prepare.request.payload, command)
  assert.deepEqual(publish.request.payload, { ...command, objects: { markdown: { key: put.key, version: 'v1' } } })
  assert.equal(prepare.options.idempotencyKey, 'save-key-0001')
  assert.equal(publish.options.idempotencyKey, 'save-key-0001')
  assert.equal(publish.request.authorization.action, 'edit')
  assert.equal(publish.request.authorization.actorUid, 'person-a')
})

test('a published candidate replays the exact command without reading the latest head or uploading', async () => {
  const bytes = Buffer.from('# mine\n')
  const state = { enabled: true, storage: null }
  state.storage = storage(state)
  let prepares = 0
  state.runtime = async (operation, request, options) => {
    assert.ok(operation.endsWith('snapshot-prepare'))
    prepares += 1
    assert.equal(options.idempotencyKey, 'save-key-0001')
    assert.deepEqual(request.payload, { generation: 4, epoch: 2, markdownSha256: sha(bytes), markdownSize: bytes.length })
    return { success: true, data: { prefix, generation: 5, replayed: true } }
  }
  assert.deepEqual(await load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 4, expectedEpoch: 2 }), { generation: 5, replayed: true })
  assert.equal(prepares, 1)
  assert.equal(state.storage.puts.length, 0)
})

test('same-key changed command is a conflict even if current content equals the draft', async () => {
  const bytes = Buffer.from('# same\n')
  const state = { storage: null }
  state.storage = storage(state)
  state.runtime = async (operation) => {
    assert.ok(operation.endsWith('snapshot-prepare'))
    throw Object.assign(new Error('key'), { statusCode: 409, data: { code: 'snapshot_key_conflict' } })
  }
  await assert.rejects(load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 4, expectedEpoch: 2 }), { statusCode: 409, data: { code: 'snapshot_key_conflict' } })
  assert.equal(state.storage.puts.length, 0)
})

test('Host requires the read version and reports the title sub-command separately', async () => {
  const updateCode = buildSync({
    entryPoints: [new URL('../server/utils/enterpriseCodocsDocumentUpdate.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['h3', '@hzy/foundation/*', '*/codocs/server/utils/oss', './enterpriseCodocsSnapshot']
  }).outputFiles[0].text
  const state = { body: { title: 'Renamed', content: '# changed', saveMode: 'overwrite', titleChanged: true },
    titleReplayed: false, calls: [], saves: [] }
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', updateCode)((name) => {
    if (name === 'h3') return {
      createError: ({ statusCode, message, data }) => Object.assign(new Error(message), { statusCode, data }),
      getHeader: () => 'save-key-0001', getRequestURL: () => new URL('https://hzy0.isme.dev/codocs/api/documents/doc-1'),
      getRouterParam: () => 'doc-1', readBody: async () => state.body, setHeader: () => {}
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => user, prepareEnterpriseRuntime: async () => true,
      enterpriseRuntimePermitExpiresAt: () => Date.now() + 15000,
      callEnterpriseRuntime: async (_event, operation, request, options) => {
        state.calls.push({ operation, request, options })
        if (operation.endsWith('personal-document-view')) return { success: true, data: { uuid: 'doc-1', doc_type: 'private', title: 'Renamed', oss_path: '' } }
        if (operation.endsWith('personal-document-update-plan')) return { success: true, data: { replayed: state.titleReplayed } }
        if (operation.endsWith('personal-document-update')) return { success: true, data: { updated: true } }
        throw Error(operation)
      }
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => ({ resources: { documents: ['edit'] }, actionPolicies: {} })
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return { authorizationResourcesAllow: () => true }
    if (name === '@hzy/foundation/server/utils/objectStorageVersion') return { objectStorageVersionId: () => 'v1' }
    if (name.endsWith('/codocs/server/utils/oss')) return { createRuntimeOSSClient: async () => ({}) }
    if (name === './enterpriseCodocsSnapshot') return {
      codocsSnapshotV2Enabled: () => true,
      saveSnapshotV2: async (...args) => { state.saves.push(args); return { generation: 5, replayed: state.titleReplayed } },
      mirrorSnapshotToLegacyPath: async () => true
    }
    return require(name)
  }, module, module.exports)
  const update = module.exports.enterpriseCodocsDocumentUpdate
  await assert.rejects(update({}), { statusCode: 428, data: { code: 'snapshot_precondition_required' } })
  assert.equal(state.saves.length, 0)
  state.body = { ...state.body, expectedGeneration: 4, expectedEpoch: 2 }
  const first = await update({})
  assert.equal(first.data.titleResult, 'updated')
  assert.equal(first.data.replayed, false)
  assert.deepEqual(state.saves[0].at(-1), { expectedGeneration: 4, expectedEpoch: 2, titleChanged: true })
  state.titleReplayed = true
  const replay = await update({})
  assert.equal(replay.data.titleResult, 'replayed')
  assert.equal(replay.data.replayed, true)
  assert.equal(state.calls.filter(call => call.operation.endsWith('personal-document-update')).length, 1)
})

test('generation conflicts and upload failures never publish', async () => {
  const bytes = Buffer.from('x')
  const state = { enabled: true }
  state.storage = storage(state)
  let published = 0
  state.runtime = async (operation) => {
    if (operation.endsWith('snapshot-read')) return { success: true, data: { generation: 0, epoch: 0 } }
    if (operation.endsWith('snapshot-prepare')) throw Object.assign(new Error('gen'), { statusCode: 409, data: { code: 'snapshot_generation_conflict' } })
    published += 1
    return { success: true, data: { generation: 1 } }
  }
  await assert.rejects(load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 0, expectedEpoch: 0 }), { statusCode: 409, data: { code: 'snapshot_generation_conflict' } })
  state.runtime = async (operation) => {
    if (operation.endsWith('snapshot-read')) return { success: true, data: { generation: 0, epoch: 0 } }
    if (operation.endsWith('snapshot-prepare')) return { success: true, data: { prefix, generation: 0, replayed: false } }
    published += 1
    return { success: true, data: { generation: 1 } }
  }
  state.failPut = true
  await assert.rejects(load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 0, expectedEpoch: 0 }), { statusCode: 503 })
  assert.equal(published, 0)
  // Missing edit permission stops before any Runtime command.
  state.failPut = false
  state.resources = { documents: ['view'] }
  await assert.rejects(load(state).saveSnapshotV2({}, user, 'doc-1', 'save-key-0001', bytes,
    { expectedGeneration: 0, expectedEpoch: 0 }), { statusCode: 403 })
  assert.equal(published, 0)
})

test('exact reads verify published length and digest', async () => {
  const state = { enabled: true }
  state.storage = storage(state)
  const body = Buffer.from('# published\n')
  await state.storage.put(`${prefix}a/body.md`, body)
  const head = { generation: 1, epoch: 0, markdown: { key: `${prefix}a/body.md`, version: 'v1' }, markdownSize: body.length, markdownSha256: sha(body) }
  const module = load(state)
  assert.equal(await module.readSnapshotMarkdown({}, head), '# published\n')
  await assert.rejects(module.readSnapshotMarkdown({}, { ...head, markdownSha256: sha('other') }), { statusCode: 503 })
  await assert.rejects(module.readSnapshotMarkdown({}, { ...head, markdown: { ...head.markdown, version: 'v404' } }), { statusCode: 503 })
})

test('the derived copy ends on the newest generation even when a newer save lands meanwhile', async () => {
  const state = { enabled: true }
  state.storage = storage(state)
  const newer = Buffer.from('# newer\n')
  await state.storage.put(`${prefix}b/body.md`, newer)
  let reads = 0
  state.runtime = async (operation) => {
    assert.ok(operation.endsWith('snapshot-read'))
    reads += 1
    return reads === 1
      ? { success: true, data: { generation: 3, epoch: 0, objects: { markdown: { key: `${prefix}b/body.md`, version: 'v1' } }, markdownSize: newer.length, markdownSha256: sha(newer) } }
      : { success: true, data: { generation: 3, epoch: 0, objects: { markdown: { key: `${prefix}b/body.md`, version: 'v1' } }, markdownSize: newer.length, markdownSha256: sha(newer) } }
  }
  const ok = await load(state).mirrorSnapshotToLegacyPath({}, user, 'doc-1', 'codocs/users/person-a/doc-1.md', 2, Buffer.from('# older\n'))
  assert.equal(ok, true)
  const mirrors = state.storage.puts.filter(put => put.key === 'codocs/users/person-a/doc-1.md')
  assert.deepEqual(mirrors.map(put => [put.bytes.toString(), put.options.meta['hzy-snapshot-generation']]), [['# older\n', '2'], ['# newer\n', '3']])
  state.failPut = true
  assert.equal(await load(state).mirrorSnapshotToLegacyPath({}, user, 'doc-1', 'codocs/users/person-a/doc-1.md', 3, newer), false, 'mirror failure is reported, not thrown')
})

test('read repair refreshes only a missing or older derived copy', async () => {
  const state = { enabled: true }
  state.storage = storage(state)
  const body = Buffer.from('# current\n')
  await state.storage.put(`${prefix}c/body.md`, body)
  const head = { generation: 4, epoch: 0, markdown: { key: `${prefix}c/body.md`, version: 'v1' }, markdownSize: body.length, markdownSha256: sha(body) }
  state.runtime = async () => ({ success: true, data: { generation: 4, epoch: 0, objects: { markdown: head.markdown }, markdownSize: body.length, markdownSha256: sha(body) } })
  const module = load(state)
  const path = 'codocs/users/person-a/doc-1.md'
  const mirrors = () => state.storage.puts.filter(put => put.key === path)
  assert.equal(await module.repairLegacyMirror({}, user, 'doc-1', path, head, '# current\n'), true, 'missing copy is written')
  assert.equal(mirrors().at(-1).options.meta['hzy-snapshot-generation'], '4')
  assert.equal(await module.repairLegacyMirror({}, user, 'doc-1', path, head, '# current\n'), false, 'current copy is left alone')
  await state.storage.put(path, Buffer.from('# stale'), { meta: { 'hzy-snapshot-generation': '3' } })
  assert.equal(await module.repairLegacyMirror({}, user, 'doc-1', path, head, '# current\n'), true, 'older copy is refreshed')
  assert.equal(mirrors().at(-1).bytes.toString(), '# current\n')
  await state.storage.put(path, Buffer.from('# legacy write'), {})
  assert.equal(await module.repairLegacyMirror({}, user, 'doc-1', path, head, '# current\n'), true, 'unstamped legacy write is replaced')
  assert.equal(await module.repairLegacyMirror({}, user, 'doc-1', path, { ...head, generation: 0 }, ''), false)
})
