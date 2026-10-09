import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const external = ['h3', '@hzy/foundation/*', '*/codocs/server/utils/oss', '*/codocs/server/utils/yjsMarkdownRecovery']
const code = buildSync({
  entryPoints: [new URL('../server/utils/enterpriseCodocsDepartmentVersions.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false, external
}).outputFiles[0].text

const sha = value => createHash('sha256').update(value).digest('hex')
const user = { uid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test' }
const UUID = '0a1b2c3d-1111-4222-8333-444455556666'
const flagKeys = ['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2', 'HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2']

function load(state) {
  const require = createRequire(import.meta.url)
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'h3') return {
      createError: details => Object.assign(new Error(details.message), details),
      getRequestURL: event => new URL(event.url),
      getQuery: event => Object.fromEntries(new URL(event.url).searchParams),
      getRouterParam: (event, key) => event[key],
      setHeader: (event, header, value) => { event.headers[header] = value }
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => user,
      prepareEnterpriseRuntime: async () => {},
      enterpriseRuntimePermitExpiresAt: () => 1000,
      callEnterpriseRuntime: async (_event, operation, request, options) => {
        state.calls.push({ operation, request, options })
        return state.runtime(operation, request)
      }
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => {
        if (state.authorizationUnavailable) throw Object.assign(new Error('Console unavailable'), { statusCode: 503 })
        return { resources: { departments: state.person ?? ['view'] }, actionPolicies: {} }
      }
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return {
      authorizationResourcesAllow: (resources, resource, action) => (resources[resource] || []).includes(action)
    }
    if (name.endsWith('/codocs/server/utils/oss')) return {
      createRuntimeOSSClient: async () => ({
        async get(key, options) {
          state.reads.push({ key, options })
          const content = state.objects.get(`${key}@${options.versionId}`)
          if (!content) throw Object.assign(new Error('missing'), { statusCode: 404 })
          return { content }
        }
      }),
      downloadDocument: async () => ''
    }
    if (name.endsWith('/codocs/server/utils/yjsMarkdownRecovery')) return { hasMeaningfulMarkdownContent: () => true, recoverMarkdownFromYjsSnapshot: async () => '' }
    return require(name)
  }, module, module.exports)
  return module.exports
}

const body = '# exact version\n'
function fixture(overrides = {}) {
  const key = 'codocs/snapshots/h/doc/k/body.md'
  const state = {
    calls: [], reads: [], objects: new Map([[`${key}@v-md`, Buffer.from(body)]]),
    rows: [{ id: 12, version_num: 2, oss_version_id: 'v-md', object_key: key, editor_uid: 'person-b', content_size: Buffer.byteLength(body), content_sha256: sha(body), created_at: '2026-09-29 10:00:00' },
      { id: 11, version_num: 1, oss_version_id: 'v-old', object_key: null, editor_uid: 'person-a', content_size: 4, content_sha256: null, created_at: '2026-09-28 10:00:00' }],
    doc: { uuid: UUID, doc_type: 'department', dept_code: 'D1', oss_path: 'codocs/departments/D1/a.md' },
    ...overrides
  }
  state.runtime = async (operation, request) => {
    if (operation.endsWith('department-documents-versions')) return { success: true, data: { items: state.rows } }
    if (operation.endsWith('department-documents-version-view')) return { success: true, data: state.rows.find(row => String(row.id) === request.objectId) }
    if (operation.endsWith('department-documents-view')) return { success: true, data: state.doc }
    throw new Error(operation)
  }
  return state
}

const event = (overrides = {}) => ({ uuid: UUID, versionId: '12', url: `https://host.test/codocs/api/departments/documents/${UUID}/versions?dept_code=D1`, headers: {}, ...overrides })
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

test('department history needs all three switches, a strict request and departments:view', async () => {
  for (const flags of [[false, true, true], [true, false, true], [true, true, false]]) {
    const state = fixture()
    await withFlags(flags, async () => {
      await assert.rejects(load(state).enterpriseCodocsDepartmentVersionsList(event()), { statusCode: 404 })
      await assert.rejects(load(state).enterpriseCodocsDepartmentVersionView(event()), { statusCode: 404 })
    })
    assert.deepEqual(state.calls, [])
  }
  const state = fixture()
  const module = load(state)
  await withFlags(on, async () => {
    const base = `https://host.test/codocs/api/departments/documents/${UUID}/versions`
    for (const url of [base, `${base}?dept_code=D1&owner_uid=victim`, `${base}?dept_code=D1&dept_code=D2`, `${base}?dept_code=../D1`]) {
      await assert.rejects(module.enterpriseCodocsDepartmentVersionsList(event({ url })), { statusCode: 400 }, url)
    }
    await assert.rejects(module.enterpriseCodocsDepartmentVersionsList(event({ uuid: 'nope' })), { statusCode: 400 })
    for (const versionId of ['0', '-1', '1.5', '../1', 'x']) {
      await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event({ versionId })), { statusCode: 400 }, versionId)
    }
    assert.deepEqual(state.calls, [])
    state.person = []
    await assert.rejects(module.enterpriseCodocsDepartmentVersionsList(event()), { statusCode: 403 })
    state.person = ['edit']
    await assert.rejects(module.enterpriseCodocsDepartmentVersionsList(event()), { statusCode: 403 })
    state.person = ['view']
    state.authorizationUnavailable = true
    await assert.rejects(module.enterpriseCodocsDepartmentVersionsList(event()), { statusCode: 503 })
    assert.deepEqual(state.calls, [], 'no Runtime call without a current person permission')
  })
})

test('list returns sanitized rows under a read permit for the department-documents resource', async () => {
  const state = fixture()
  const module = load(state)
  await withFlags(on, async () => {
    const e = event()
    const result = await module.enterpriseCodocsDepartmentVersionsList(e)
    assert.equal(e.headers['Cache-Control'], 'no-store')
    assert.deepEqual(result.data.map(row => [row.id, row.versionNum, row.objectKey !== null]), [[12, 2, true], [11, 1, false]])
    const [call] = state.calls
    assert.equal(call.operation, 'codocs.department-documents-versions')
    assert.equal(call.request.code, 'D1')
    assert.equal(call.request.subId, UUID)
    assert.deepEqual(call.request.authorization, { actorUid: 'person-a', tenant: 'tenant-a', deployment: 'enterprise-test', resource: 'department-documents', action: 'read', expiresAt: 1000 })
    assert.equal(call.options, undefined)
  })
})

test('view reads the exact snapshot object, verifies its digest and never touches the mirror', async () => {
  const state = fixture()
  const module = load(state)
  await withFlags(on, async () => {
    const result = await module.enterpriseCodocsDepartmentVersionView(event())
    assert.deepEqual(result.data, { content: body, versionNum: 2, editorUid: 'person-b', createdAt: '2026-09-29 10:00:00' })
    assert.deepEqual(state.reads, [{ key: 'codocs/snapshots/h/doc/k/body.md', options: { versionId: 'v-md' } }])
    assert.deepEqual(state.calls.map(call => call.operation), ['codocs.department-documents-version-view'], 'no document metadata call for a snapshot row')

    state.objects.set('codocs/snapshots/h/doc/k/body.md@v-md', Buffer.from('# tampered\n'))
    await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event()), { statusCode: 503 })
  })
})

test('view refuses rows that name a foreign object and metadata outside the requested department', async () => {
  const state = fixture()
  state.rows[0].object_key = 'codocs/departments/D1/a.md'
  const module = load(state)
  await withFlags(on, async () => {
    await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event()), { statusCode: 503 })
    assert.deepEqual(state.reads, [])
    // A legacy row reads the document path, after the department is confirmed.
    state.objects.set('codocs/departments/D1/a.md@v-old', Buffer.from('old!'))
    state.doc = { ...state.doc, dept_code: 'D2' }
    await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event({ versionId: '11' })), { statusCode: 503 })
    assert.deepEqual(state.reads, [])
    state.doc = { ...state.doc, dept_code: 'D1' }
    state.rows[1].oss_version_id = 'v-old'
    const result = await module.enterpriseCodocsDepartmentVersionView(event({ versionId: '11' }))
    assert.equal(result.data.content, 'old!')
    assert.equal(state.reads.length, 1)
  })
})

test('view maps an expired superseded v1 version to 410 and a missing snapshot object to 404', async () => {
  const state = fixture()
  const module = load(state)
  await withFlags(on, async () => {
    state.rows[1].oss_version_id = 'v-gone'
    await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event({ versionId: '11' })), { statusCode: 410 })
    state.objects.clear()
    await assert.rejects(module.enterpriseCodocsDepartmentVersionView(event()), { statusCode: 404 })
  })
})
