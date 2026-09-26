import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('Host readiness admits only GET for Codocs transfer targets', () => {
  assert.equal(isBusinessApiReady('GET', '/codocs/api/document-transfer/targets'), true)
  assert.equal(isBusinessApiReady('POST', '/codocs/api/document-transfer/targets'), false)
})

test('Codocs transfer targets use the current user and fail closed before directory reads', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = {
    authenticated: true,
    authorization: { resources: { documents: ['edit'] }, actionPolicies: {} },
    departments: { departments: [{ deptCode: 'dept-a', name: '研发部' }], primaryDeptCode: 'dept-a' },
    projects: { managed: [{ projectCode: 'project-a', name: '项目 A' }], joined: [] },
    calls: [],
    preparations: [],
    directoryFailure: false
  }
  const previous = { defineEventHandler: globalThis.defineEventHandler, createError: globalThis.__codocsTransferTargetsCreateError, state: globalThis.__codocsTransferTargetsState }
  globalThis.defineEventHandler = handler => handler
  globalThis.__codocsTransferTargetsCreateError = createError
  globalThis.__codocsTransferTargetsState = state
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let source
      if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
        export const requireEnterpriseUser = async () => { if (!globalThis.__codocsTransferTargetsState.authenticated) throw globalThis.__codocsTransferTargetsCreateError({ statusCode: 401, message: '未登录' }); return { uid: 'person-a' } }
        export const prepareEnterpriseRuntime = async (_event, operation) => { globalThis.__codocsTransferTargetsState.preparations.push(operation) }
        export const callEnterpriseRuntime = async (_event, operation, body) => { const state = globalThis.__codocsTransferTargetsState; state.calls.push({ operation, body }); if (state.directoryFailure) throw new Error('directory unavailable'); return { data: state[operation.endsWith('departments') ? 'departments' : 'projects'] } }
      `
      if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime = async () => globalThis.__codocsTransferTargetsState.authorization'
      if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow = (resources, resource, action) => Array.isArray(resources?.[resource]) && resources[resource].includes(action)'
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      let candidate
      if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
      else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      return next(specifier, context)
    }
  })

  let server
  try {
    const app = createApp()
    const router = createRouter()
    router.get('/targets', (await import('../server/routes/codocs/api/document-transfer/targets.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)

    assert.equal((await request('/targets?target=project&uid=another')).status, 400)
    assert.deepEqual(state.calls, [])
    state.authenticated = false
    assert.equal((await request('/targets?target=project')).status, 401)
    state.authenticated = true
    state.authorization = { resources: { documents: ['view'] }, actionPolicies: {} }
    assert.equal((await request('/targets?target=project')).status, 403)
    assert.deepEqual(state.calls, [])
    assert.deepEqual(state.preparations, [])

    state.authorization = { resources: { documents: ['edit'] }, actionPolicies: {} }
    const department = await request('/targets?target=department')
    assert.equal(department.status, 200)
    assert.equal(department.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await department.json()).data, state.departments)
    const project = await request('/targets?target=project')
    assert.equal(project.status, 200)
    assert.deepEqual((await project.json()).data, state.projects)
    assert.deepEqual(state.calls, [{ operation: 'console.directory-self-departments', body: {} }, { operation: 'console.directory-self-projects', body: {} }])
    assert.deepEqual(state.preparations, ['codocs.document-transfer-department', 'console.directory-self-departments', 'codocs.document-transfer-project', 'console.directory-self-projects'])

    state.directoryFailure = true
    assert.equal((await request('/targets?target=project')).status, 503)
    state.directoryFailure = false
    state.projects = { managed: null, joined: [] }
    assert.equal((await request('/targets?target=project')).status, 503)
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.defineEventHandler = previous.defineEventHandler
    globalThis.__codocsTransferTargetsCreateError = previous.createError
    globalThis.__codocsTransferTargetsState = previous.state
  }
})
