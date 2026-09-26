import test from 'node:test'
import { assertMigratedPage } from './helpers/migrated-page.mjs'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createError, createRouter, toNodeListener } from 'h3'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
test('project plan BFF requires existing project and work item view resources', () => {
  const source = read('server/utils/enterpriseAimsProjectPlan.ts')
  assert.match(source, /\['projects', 'work_items'\]/)
  assert.doesNotMatch(source, /\['milestones', 'work_items'\]/)
  assert.match(source, /authorizationResourcesAllow/)
  assert.match(source, /enterpriseAimsProjectScope/)
  assert.match(source, /projectId/)
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PATCH|DELETE)/)
})

test('project plan permits both views, denies either missing view and hides out-of-scope projects', async () => {
  const state = { resources: { projects: ['view'], work_items: ['view'] }, scopeAllowed: true, calls: [] }
  const oldState = globalThis.__planGateState
  const oldCreateError = globalThis.__planCreateError
  globalThis.__planGateState = state
  globalThis.__planCreateError = createError
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `
      export const requireEnterpriseUser = async () => ({uid:'manager',tenant:'C000001',deployment:'enterprise-test'})
      export const enterpriseRuntimePermitExpiresAt = () => '2099-01-01T00:00:00Z'
      export const prepareEnterpriseRuntime = async () => {}
      export const callEnterpriseRuntime = async (_event,operation,input) => { globalThis.__planGateState.calls.push({operation,projectId:input.projectId}); return {data:[]} }
    `
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime = async () => ({resources:globalThis.__planGateState.resources,actionPolicies:{}})'
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow = (resources,resource,action) => resources[resource]?.includes(action) === true'
    if (specifier === './enterpriseAimsProjects') source = `export const enterpriseAimsProjectScope = async () => {if(!globalThis.__planGateState.scopeAllowed) throw globalThis.__planCreateError({statusCode:404,message:'not found'});return {}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const app = createApp()
    const router = createRouter()
    router.get('/projects/:id/plan', (await import('../server/routes/aims/api/v1/projects/[id]/plan.get.ts')).default)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const request = () => fetch(`http://127.0.0.1:${server.address().port}/projects/257/plan`)
    assert.equal((await request()).status, 200)
    assert.deepEqual(state.calls.map(call => call.projectId), ['257', '257'])
    for (const missing of ['projects', 'work_items']) {
      state.calls.length = 0
      state.resources = { projects: ['view'], work_items: ['view'] }
      delete state.resources[missing]
      assert.equal((await request()).status, 403)
      assert.deepEqual(state.calls, [])
    }
    state.resources = { projects: ['view'], work_items: ['view'] }
    state.scopeAllowed = false
    assert.equal((await request()).status, 404)
    assert.deepEqual(state.calls, [])
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    globalThis.__planGateState = oldState
    globalThis.__planCreateError = oldCreateError
  }
})
test('project plan route serves the original Aims page with a host-safe closure', () => {
  // 原断言锁的是薄改写页"仅供读取"。切到原页面后该前提不成立（原计划页含里程碑
  // 周期开启等写操作）。rollover 走 Aims 的 service 路径、Runtime 不做逐用户判定，
  // 因此额外要求宿主 BFF 自行判定项目经理或范围管理员。
  assertMigratedPage({ route: '/projects/:id/plan', name: 'project-plan', source: 'projects/[id]/plan' })
  const bff = read('server/utils/enterpriseAimsPlanActions.ts')
  assert.match(bff, /currentUserRole/)
  assert.match(bff, /仅项目经理或具备该项目范围管理权限的用户可以开启下一周期/)
  assert.match(bff, /Runtime 这条路径不做逐用户判定/)
})
