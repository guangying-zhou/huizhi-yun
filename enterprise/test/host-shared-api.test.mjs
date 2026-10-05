import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { enterpriseSharedApiBase, resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'
import { ENTERPRISE_SHARED_API_BASE, resolveSharedApiPath } from '../../foundation/shared/utils/sharedApiPath.ts'

const root = resolve(import.meta.dirname, '../..')
const sharedRoutes = resolve(root, 'enterprise/server/routes/enterprise/api/foundation')

// G-12: the Foundation user APIs Host pages actually call. Root /api/* is
// Console behind the tenant gateway, so the Host serves exactly these.
const expected = [
  ['GET', '/workflow-proxy/instances/by-biz', 'workflow:by-biz'],
  ['GET', '/workflow-proxy/instances/by-biz-history', 'workflow:history'],
  ['GET', '/workflow-proxy/instances/:id', 'workflow:instance'],
  ['GET', '/workflow-proxy/tasks/pending', 'workflow:pending'],
  ['GET', '/workflow-proxy/tasks/:id', 'workflow:task'],
  ['POST', '/workflow-proxy/tasks/:id/approve', 'workflow:approve'],
  ['POST', '/workflow-proxy/tasks/:id/reject', 'workflow:reject'],
  ['GET', '/notifications', 'notifications/index.get'],
  ['GET', '/notifications/summary', 'notifications/summary.get'],
  ['POST', '/notifications/read-all', 'notifications/read-all.post'],
  ['GET', '/notifications/:notificationId/detail', 'notifications/[notificationId]/detail.get'],
  ['POST', '/notifications/:notificationId/read', 'notifications/[notificationId]/read.post'],
  ['POST', '/notifications/:notificationId/archive', 'notifications/[notificationId]/archive.post'],
  ['GET', '/user/applications', 'user/applications.get'],
  ['GET', '/directory/me', 'directory/me.get'],
  ['GET', '/directory/users', 'directory/users/index.get'],
  ['POST', '/directory/users/batch', 'directory/users/batch.post'],
  ['GET', '/directory/departments', 'directory/departments/index.get'],
  ['GET', '/directory/projects', 'directory/projects/index.get'],
  ['GET', '/directory/business-domains', 'directory/business-domains.get']
]

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(resolve(dir, entry.name))
    : [resolve(dir, entry.name)])
}

function routeOf(file) {
  const rel = relative(sharedRoutes, file).replace(/\.ts$/, '')
  const [, path, method] = rel.match(/^(.*)\.(get|post)$/)
  return [method.toUpperCase(), `/${path.replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1')}`]
}

const sample = path => path.replace(':id', '12').replace(':notificationId', 'ntf_01-A')

test('Host shared API files, gateway topology and readiness describe the same exact surface', () => {
  const files = walk(sharedRoutes).map(routeOf).map(([method, path]) => `${method} ${path}`).sort()
  assert.deepEqual(files, expected.map(([method, path]) => `${method} ${path}`).sort())
  assert.equal(enterpriseSharedApiBase, ENTERPRISE_SHARED_API_BASE)
  for (const [method, path] of expected) {
    const url = `${enterpriseSharedApiBase}${sample(path)}`
    assert.deepEqual(resolveEnterprisePilotPath(url, '', method), { path: url, kind: 'api' }, `${method} ${url}`)
    assert.equal(isBusinessApiReady(method, url), true, `${method} ${url} readiness`)
    const other = method === 'GET' ? 'POST' : 'GET'
    assert.equal(resolveEnterprisePilotPath(url, '', other).kind, 'unavailable', `${other} ${url}`)
    assert.equal(resolveEnterprisePilotPath(url, '', 'DELETE').kind, 'unavailable', `DELETE ${url}`)
  }
  for (const path of [
    '/workflow-proxy/tasks/done', '/workflow-proxy/tasks/12/delegate', '/workflow-proxy/instances', '/workflow-proxy/instances/prepare',
    '/workflow-proxy/tasks/0', '/workflow-proxy/tasks/abc', '/notifications/a%2fb/detail', '/notifications/x/delete',
    '/directory/user-departments', '/directory/users/U1', '/directory/departments/D1/members', '/directory/meta',
    '/user/applications/secret', '/auth/me', '/internal/test', ''
  ]) {
    for (const method of ['GET', 'POST']) {
      assert.equal(resolveEnterprisePilotPath(`${enterpriseSharedApiBase}${path}`, '', method).kind, 'unavailable', `${method} ${path}`)
    }
  }
  // Root /api/* keeps belonging to Console; nothing here widens it.
  for (const path of ['/api/notifications', '/api/directory/users', '/api/user/applications', '/api/workflow-proxy/tasks/pending']) {
    assert.equal(resolveEnterprisePilotPath(path, '', 'GET'), null)
  }
})

test('each Host shared route reuses the root handler and requires the Host session', () => {
  for (const [method, path, source] of expected) {
    const file = resolve(sharedRoutes, `${path.slice(1).replace(/:([A-Za-z]+)/g, '[$1]')}${['/notifications', '/directory/users', '/directory/departments', '/directory/projects'].includes(path) ? '/index' : ''}.${method.toLowerCase()}.ts`)
    assert.ok(existsSync(file), file)
    const content = readFileSync(file, 'utf8')
    if (source.startsWith('workflow:')) {
      // The same Host Workflow operation as the root route; it verifies the session itself.
      const operation = source.slice('workflow:'.length)
      assert.match(content, new RegExp(`enterpriseWorkflowProxy\\(event, '${operation}'\\)`))
      const rootFile = resolve(root, 'enterprise/server/routes/api', relative(sharedRoutes, file))
      assert.match(readFileSync(rootFile, 'utf8'), new RegExp(`enterpriseWorkflowProxy\\(event, '${operation}'\\)`))
      continue
    }
    assert.ok(existsSync(resolve(root, 'foundation/server/api', `${source}.ts`)), source)
    assert.match(content, new RegExp(`^import handler from '@hzy/foundation/server/api/${source.replace(/[[\]]/g, '\\$&')}'$`, 'm'))
    assert.match(content, /^export default enterpriseSharedApi\(handler\)$/m)
    assert.doesNotMatch(content, /getHeader|x-hzy-actor|allowedApps|requestServiceAccessToken/)
  }
  const helper = readFileSync(resolve(root, 'enterprise/server/utils/enterpriseSharedApi.ts'), 'utf8')
  assert.match(helper, /await requireEnterpriseUser\(event\)\n\s*return await handler\(event\)/)
  assert.doesNotMatch(helper, /getHeader|getCookie|getQuery/)
})

test('enterpriseSharedApi rejects a request without a Host session before the Foundation handler runs', async () => {
  let authenticated = false
  let handled = 0
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient') {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export async function requireEnterpriseUser(){if(!globalThis.__sharedAuth())throw globalThis.__sharedError(401);return {uid:"U1",tenant:"C000001",deployment:"C000001-test-enterprise"}}')}` }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { shortCircuit: true, url: pathToFileURL(`${candidate}.ts`).href }
    }
    return next(specifier, context)
  } })
  globalThis.__sharedAuth = () => authenticated
  globalThis.__sharedError = statusCode => createError({ statusCode })
  let server
  try {
    const { enterpriseSharedApi } = await import(pathToFileURL(resolve(root, 'enterprise/server/utils/enterpriseSharedApi.ts')).href)
    const router = createRouter().get('/probe', enterpriseSharedApi(defineEventHandler(() => {
      handled++
      return { code: 0 }
    })))
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const url = `http://127.0.0.1:${server.address().port}/probe`
    assert.equal((await fetch(url, { headers: { 'x-hzy-actor-uid': 'U1', 'cookie': 'auth_user=U1' } })).status, 401)
    assert.equal(handled, 0)
    authenticated = true
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { code: 0 })
    assert.equal(handled, 1)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    hooks.deregister()
    delete globalThis.__sharedAuth
    delete globalThis.__sharedError
  }
})

test('Host client code reaches Foundation user APIs only through the shared API base', () => {
  const nuxt = readFileSync(resolve(root, 'enterprise/nuxt.config.ts'), 'utf8')
  assert.match(nuxt, /sharedApiBase: pilot \? '\/enterprise\/api\/foundation' : '\/api'/)
  assert.match(nuxt, /icon: pilot \? \{ localApiEndpoint: '\/enterprise\/_nuxt_icon' \} : \{\}/)
  assert.equal(resolveSharedApiPath('/api/notifications', { appCode: 'enterprise', sharedApiBase: '/enterprise/api/foundation' }), '/enterprise/api/foundation/notifications')
  assert.equal(resolveSharedApiPath('/api/notifications', { appCode: 'enterprise', sharedApiBase: '/api' }), '/api/notifications')
  const app = walk(resolve(root, 'enterprise/app')).filter(file => /\.(?:vue|ts)$/.test(file))
  for (const file of app) {
    const content = readFileSync(file, 'utf8')
    assert.doesNotMatch(content, /(?:\$fetch|useFetch|fetch)(?:<[^(]*>)?\(\s*(?:\(\)\s*=>\s*)?['"`]\/api\//, relative(root, file))
  }
  for (const file of ['foundation/app/composables/useNotifications.ts', 'foundation/app/composables/useUserApplications.ts', 'foundation/app/composables/useWorkflow.ts', 'foundation/app/composables/useDirectory.ts', 'foundation/app/stores/directory.ts', 'codocs/app/composables/useViewerWatermark.ts']) {
    const content = readFileSync(resolve(root, file), 'utf8')
    assert.match(content, /sharedApiPath\('\/api\//, file)
    assert.doesNotMatch(content, /(?:\$fetch|requestFetch)(?:<[^(]*>)?\(\s*['"`]\/api\/(?:notifications|user\/applications|workflow-proxy|directory)/, file)
  }
})

test('the Workflow boundary applies the same seven exact operations under the shared base', () => {
  const boundary = readFileSync(resolve(root, 'enterprise/server/middleware/02-workflow-boundary.ts'), 'utf8')
  assert.match(boundary, /const hostShared = '\/enterprise\/api\/foundation\/workflow-proxy\/'/)
  assert.match(boundary, /requested\.startsWith\(hostShared\) \? `\/api\/workflow-proxy\/\$\{requested\.slice\(hostShared\.length\)\}` : requested/)
})
