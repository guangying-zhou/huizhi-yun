import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

const code = buildSync({
  entryPoints: [new URL('../server/utils/enterpriseCodocsCollaboration.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['h3', '@hzy/foundation/*']
}).outputFiles[0].text

function load(state) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'h3') return {
      createError: details => Object.assign(new Error(details.message), details),
      getRequestURL: event => new URL(event.url),
      getRouterParam: event => event.uuid,
      getHeader: (event, name) => event.headers[name],
      setHeader: (event, name, value) => { event.headers[name] = value }
    }
    if (name === '@hzy/foundation/server/utils/enterpriseRuntimeClient') return {
      requireEnterpriseUser: async () => ({ uid: 'person-a', tenant: 'tenant-a', deployment: 'test-a' }),
      prepareEnterpriseRuntime: async () => { state.calls.push('prepare') },
      enterpriseRuntimePermitExpiresAt: () => 1000,
      callEnterpriseRuntime: async (_event, operation, request) => {
        state.calls.push({ operation, request })
        return state.response
      }
    }
    if (name === '@hzy/foundation/server/utils/platformBundleAuthorization') return {
      loadAuthorizationSnapshotFromConsoleRuntime: async () => {
        if (state.authorizationUnavailable) throw Object.assign(new Error('Console unavailable'), { statusCode: 503 })
        return { resources: { documents: state.allowed ? ['edit'] : [] }, actionPolicies: {} }
      }
    }
    if (name === '@hzy/foundation/shared/utils/authorizationActions') return {
      authorizationResourcesAllow: (resources, resource, action) => resources[resource]?.includes(action) || false
    }
    throw new Error(`Unexpected dependency: ${name}`)
  }, module, module.exports)
  return module.exports
}

test('Host v2 collaboration opens an exact user session and returns a one-time ticket', async () => {
  const before = [process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2, process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2]
  const state = { calls: [], allowed: true, response: { success: true, data: { ticket: 'a'.repeat(64), sessionId: 'session-a', expiresAt: 1000 } } }
  const event = { uuid: 'doc-1', url: 'https://host.test/codocs/api/documents/doc-1/collaboration', headers: {} }
  try {
    const open = load(state).enterpriseCodocsCollaborationOpen
    delete process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2
    await assert.rejects(open(event), { statusCode: 404 })
    assert.deepEqual(state.calls, [])
    process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 = 'true'
    process.env.HZY_ENTERPRISE_CODOCS_COLLABORATION_V2 = 'true'

    state.allowed = false
    await assert.rejects(open(event), { statusCode: 403 })
    assert.deepEqual(state.calls, [], 'denied users cannot prepare or call Runtime')
    state.authorizationUnavailable = true
    await assert.rejects(open(event), { statusCode: 503 })
    assert.deepEqual(state.calls, [], 'authorization outages cannot prepare or call Runtime')
    state.authorizationUnavailable = false
    state.allowed = true
    assert.deepEqual(await open(event), { success: true, data: { token: `v2.${'a'.repeat(64)}`, sessionId: 'session-a', expiresAt: 1000 } })
    assert.equal(event.headers['Cache-Control'], 'no-store')
    assert.equal(state.calls[0], 'prepare')
    assert.equal(state.calls[1].operation, 'codocs.personal-document-collaboration-open')
    assert.equal(state.calls[1].request.code, 'doc-1')
    assert.deepEqual(state.calls[1].request.authorization, {
      actorUid: 'person-a', tenant: 'tenant-a', deployment: 'test-a', resource: 'personal-documents', action: 'edit', expiresAt: 1000
    })

    const count = state.calls.length
    await assert.rejects(open({ ...event, url: `${event.url}?actor=victim` }), { statusCode: 400 })
    await assert.rejects(open({ ...event, headers: { 'content-length': '2' } }), { statusCode: 400 })
    await assert.rejects(open({ ...event, headers: { 'transfer-encoding': 'chunked' } }), { statusCode: 400 })
    assert.equal(state.calls.length, count)
    state.response = { success: true, data: { ticket: 'bad', sessionId: 'session-a' } }
    await assert.rejects(open(event), { statusCode: 503 })
  } finally {
    ;['HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2', 'HZY_ENTERPRISE_CODOCS_COLLABORATION_V2'].forEach((key, i) => {
      if (before[i] === undefined) delete process.env[key]
      else process.env[key] = before[i]
    })
  }
})
