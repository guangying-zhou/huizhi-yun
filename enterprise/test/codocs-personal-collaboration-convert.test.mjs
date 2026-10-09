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
const openCode = bundle('enterpriseCodocsCollaboration.ts')

const sha = value => createHash('sha256').update(value).digest('hex')
const user = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const UUID = '0a1b2c3d-1111-4222-8333-444455556666'
const prefix = 'codocs/snapshots/h/doc/k/'
const flagKeys = ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2']

function load(code, state) {
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@hzy/foundation/shared/utils/optionalReadPagination') return { optionalReadPagination: () => ({}) }
    if (name === 'h3') return {
      createError: details => Object.assign(new Error(details.message), details),
      getRequestURL: event => new URL(event.url),
      getQuery: event => Object.fromEntries(new URL(event.url).searchParams),
      getRouterParam: event => event.uuid,
      getHeader: (event, header) => event.headers[header],
      setHeader: (event, header, value) => { event.headers[header] = value }
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async event => ({ ...user, uid: event.actor ?? user.uid }),
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
        return { resources: { documents: state.person ?? ['view', 'edit'] }, actionPolicies: {} }
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

function conflict(code) {
  return Object.assign(new Error(code), { statusCode: 409, data: { code } })
}
function fixture(overrides = {}) {
  const state = {
    calls: [], downloads: [], heads: [], legacy: '# v1 body\n', generation: 0, publications: 0,
    doc: { uuid: UUID, doc_type: 'private', status: 1, readonly_flag: 0, oss_path: 'codocs/private/a.md', updated_at: new Date(Date.now() - 3_600_000).toISOString() },
    ...overrides
  }
  state.storage = storage(state)
  state.runtime = async (operation, request) => {
    if (operation.endsWith('collaboration-open')) {
      if (state.aclDenied) throw Object.assign(new Error('permission_denied'), { statusCode: 403 })
      if (!state.generation) throw conflict('document_not_on_snapshot_v2')
      return { success: true, data: { sessionId: 'session-a', ticket: 'a'.repeat(64), expiresAt: 'later' } }
    }
    if (operation.endsWith('-view')) return { success: true, data: state.doc }
    if (operation.endsWith('snapshot-read')) return { success: true, data: state.generation
      ? { generation: state.generation, epoch: 7, objects: { markdown: { key: 'snapshot.md', version: 'v1' } }, markdownSize: 10, markdownSha256: 'a'.repeat(64) }
      : { generation: 0, epoch: 7 } }
    if (operation.endsWith('snapshot-prepare')) {
      if (state.generation) throw conflict('snapshot_generation_conflict')
      if (state.prepareDenied) throw Object.assign(new Error('permission_denied'), { statusCode: 403 })
      return { success: true, data: { prefix, generation: 0, replayed: false } }
    }
    if (operation.endsWith('snapshot-publish')) {
      if (state.publishFail) throw Object.assign(new Error('dependency unavailable'), { statusCode: 503 })
      if (state.generation) throw conflict('snapshot_generation_conflict')
      assert.equal(request.payload.markdownSize, Buffer.byteLength(state.legacy))
      assert.equal(request.payload.markdownSha256, sha(state.legacy))
      state.generation = 1
      state.publications++
      return { success: true, data: { generation: 1, replayed: false } }
    }
    throw new Error(operation)
  }
  return state
}
const event = (actor = user.uid) => ({ actor, uuid: UUID, url: `https://host.test/codocs/api/documents/${UUID}/collaboration`, headers: {} })
async function enabled(action) {
  const before = flagKeys.map(key => process.env[key])
  flagKeys.forEach((key) => {
    process.env[key] = 'true'
  })
  try {
    await action()
  } finally {
    flagKeys.forEach((key, i) => {
      if (before[i] === undefined) delete process.env[key]
      else process.env[key] = before[i]
    })
  }
}
const writes = state => state.calls.filter(x => x.operation?.endsWith('snapshot-prepare') || x.operation?.endsWith('snapshot-publish'))

test('legacy writer first open converts authoritative bytes once before issuing ticket', () => enabled(async () => {
  const state = fixture()
  const open = load(openCode, state).enterpriseCodocsCollaborationOpen
  assert.match((await open(event())).data.token, /^v2\./)
  assert.equal(state.publications, 1)
  assert.deepEqual(state.storage.puts[0].bytes, Buffer.from(state.legacy))
  assert.equal(writes(state)[0].request.payload.generation, 0)
  assert.equal(writes(state)[0].request.payload.epoch, 7)
  await open(event())
  assert.equal(state.storage.puts.length, 1)
  assert.equal(state.publications, 1)
}))

test('two writers racing first open publish only generation one, both join after fresh ACL read', () => enabled(async () => {
  const state = fixture()
  const open = load(openCode, state).enterpriseCodocsCollaborationOpen
  await Promise.all([open(event()), open(event('writer-b'))])
  assert.equal(state.publications, 1)
  assert.equal(state.generation, 1)
}))

test('read-only, revoked or recycled ACL refusal cannot initiate conversion or storage access', () => enabled(async () => {
  for (const overrides of [{ person: ['view'] }, { aclDenied: true }]) {
    const state = fixture(overrides)
    await assert.rejects(load(openCode, state).enterpriseCodocsCollaborationOpen(event()), { statusCode: 403 })
    assert.equal(writes(state).length, 0)
    assert.equal(state.downloads.length, 0)
    assert.equal(state.storage.puts.length, 0)
  }
  const state = fixture({ prepareDenied: true })
  await assert.rejects(load(openCode, state).enterpriseCodocsCollaborationOpen(event()), { statusCode: 403 })
  assert.equal(state.storage.puts.length, 0, 'revocation at prepare stops upload')
}))

test('failed conversion retries original intent, never creates a second published snapshot', () => enabled(async () => {
  const state = fixture({ publishFail: true })
  const open = load(openCode, state).enterpriseCodocsCollaborationOpen
  await assert.rejects(open(event()), { statusCode: 503 })
  const key = writes(state)[0].options.idempotencyKey
  state.publishFail = false
  await open(event())
  assert.ok(writes(state).every(x => x.options.idempotencyKey === key))
  assert.equal(state.publications, 1)
  await open(event())
  assert.equal(state.publications, 1)
}))

test('large image/table Markdown survives conversion byte-for-byte; oversize fails before prepare/upload', () => enabled(async () => {
  const legacy = '# 大图与表格\n\n![图](data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024) + ')\n\n|列|值|\n|---|---|\n|测试|完整|\n'
  const state = fixture({ legacy })
  await load(openCode, state).enterpriseCodocsCollaborationOpen(event())
  assert.deepEqual(state.storage.puts[0].bytes, Buffer.from(legacy))
  const large = fixture({ legacy: 'x'.repeat(10 * 1024 * 1024 + 1) })
  await assert.rejects(load(openCode, large).enterpriseCodocsCollaborationOpen(event()), { statusCode: 413 })
  assert.equal(writes(large).length, 0)
  assert.equal(large.storage.puts.length, 0)
}))

test('recent legacy activity and storage outage are not swallowed and never issue ticket', () => enabled(async () => {
  const state = fixture()
  state.doc.updated_at = new Date().toISOString()
  await assert.rejects(load(openCode, state).enterpriseCodocsCollaborationOpen(event()), { statusCode: 409 })
  assert.equal(state.downloads.length, 0)
  const outage = fixture({ yjsHeadError: Object.assign(new Error('storage unavailable'), { statusCode: 503 }) })
  await assert.rejects(load(openCode, outage).enterpriseCodocsCollaborationOpen(event()), { statusCode: 503 })
  assert.equal(outage.publications, 0)
}))

test('already-v2 requests bypass conversion entirely; unrelated conflicts never convert', () => enabled(async () => {
  const state = fixture({ generation: 2 })
  await load(openCode, state).enterpriseCodocsCollaborationOpen(event())
  assert.equal(state.downloads.length, 0)
  assert.equal(writes(state).length, 0)
  const denied = fixture()
  denied.runtime = async () => {
    throw conflict('document_collaboration_active')
  }
  await assert.rejects(load(openCode, denied).enterpriseCodocsCollaborationOpen(event()), { statusCode: 409 })
  assert.equal(denied.downloads.length, 0)
}))

test('successful conversion does not bypass the final current ACL ticket check', () => enabled(async () => {
  const state = fixture()
  const runtime = state.runtime
  state.runtime = async (...args) => {
    const response = await runtime(...args)
    if (args[0].endsWith('snapshot-publish')) state.aclDenied = true
    return response
  }
  await assert.rejects(load(openCode, state).enterpriseCodocsCollaborationOpen(event()), { statusCode: 403 })
  assert.equal(state.publications, 1)
}))

test('concurrent conversion between legacy head and metadata read joins published v2 instead of mistaking it for legacy activity', () => enabled(async () => {
  const state = fixture()
  const runtime = state.runtime
  state.runtime = async (...args) => {
    if (args[0].endsWith('-view')) {
      state.generation = 1
      state.doc.updated_at = new Date().toISOString()
    }
    return runtime(...args)
  }
  await load(openCode, state).enterpriseCodocsCollaborationOpen(event())
  assert.equal(writes(state).length, 0)
  assert.equal(state.downloads.length, 0)
}))
