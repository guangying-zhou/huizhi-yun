import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'

test('Host readiness admits only GET for Aims accessible departments', () => {
  assert.equal(isBusinessApiReady('GET', '/aims/api/account/accessible-departments'), true)
  assert.equal(isBusinessApiReady('POST', '/aims/api/account/accessible-departments'), false)
})

test('Host accessible departments use only the directory-self operation and never the legacy directory API', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../server/routes/aims/api/account/accessible-departments.get.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(source, /userDepartments|directoryApi|fetchDirectoryApi|getQuery|readBody|uid/)
  assert.match(source, /'console\.directory-self-accessible-departments'/)
})

test('Host accessible departments call the fixed operation for the session actor and map failures', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const state = { authenticated: true, calls: [], preparations: [], mode: 'ok', response: null }
  const previous = { createError: globalThis.__accessibleDepartmentsCreateError, state: globalThis.__accessibleDepartmentsState }
  globalThis.__accessibleDepartmentsCreateError = createError
  globalThis.__accessibleDepartmentsState = state
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.endsWith('/enterpriseRuntimeClient')) {
        const source = `
          const s = () => globalThis.__accessibleDepartmentsState
          const fail = status => { const e = new Error('runtime ' + status); e.statusCode = status; throw e }
          export const requireEnterpriseUser = async () => { if (!s().authenticated) throw globalThis.__accessibleDepartmentsCreateError({ statusCode: 401, message: '未登录' }); return { uid: 'person-a' } }
          export const prepareEnterpriseRuntime = async (_event, operation) => { s().preparations.push(operation) }
          export const callEnterpriseRuntime = async (_event, operation, body, options) => {
            s().calls.push({ operation, body, options })
            if (typeof s().mode === 'number') fail(s().mode)
            if (s().mode === 'throw') throw new Error('network')
            return s().response
          }
        `
        return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      }
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
    router.get('/departments', (await import('../server/routes/aims/api/account/accessible-departments.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)

    state.authenticated = false
    assert.equal((await request('/departments')).status, 401)
    assert.deepEqual(state.calls, [])
    state.authenticated = true

    state.response = { code: 0, data: [{ deptCode: 'dept-a', name: '研发部', managerId: 'manager-a', leaderId: 'leader-a', members: ['x'] }, { deptCode: 'dept-a-1', name: '研发一组' }] }
    const ok = await request('/departments?uid=other&actorUid=other')
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await ok.json(), { code: 0, data: [{ deptCode: 'dept-a', name: '研发部' }, { deptCode: 'dept-a-1', name: '研发一组' }] })
    // The caller-supplied uid never reaches Runtime: fixed operation, empty body.
    assert.deepEqual(state.calls, [{ operation: 'console.directory-self-accessible-departments', body: {}, options: undefined }])
    assert.deepEqual(state.preparations, ['console.directory-self-accessible-departments'])

    for (const [mode, status] of [[403, 403], [401, 401], [503, 503], [400, 503], [502, 503], ['throw', 503]]) {
      state.mode = mode
      const response = await request('/departments')
      assert.equal(response.status, status, `runtime ${mode}`)
    }
    state.mode = 'ok'
    for (const invalid of [{ code: 0, data: null }, { code: 0, data: [{ deptCode: 1, name: 'x' }] }, null]) {
      state.response = invalid
      assert.equal((await request('/departments')).status, 503)
    }
    state.response = { code: 0, data: [] }
    assert.deepEqual(await (await request('/departments')).json(), { code: 0, data: [] })
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.__accessibleDepartmentsCreateError = previous.createError
    globalThis.__accessibleDepartmentsState = previous.state
  }
})
