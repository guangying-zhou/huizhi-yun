import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

// plan.vue 按里程碑读取工作项时只发 milestone_id，不带分页。Host 曾把缺省分页
// 合成为 pageSize: undefined 键，optionalReadPagination 以“键存在”判定而整表 400。
test('project work-item list accepts the exact keys Aims pages send and keeps strict validation', async () => {
  const calls = []
  globalThis.__projectWorkItemListCall = async (_event, op, input) => {
    calls.push({ op, input })
    return { code: 0, data: { items: [], total: 0 } }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/enterpriseRuntimeClient')) return { url: 'data:text/javascript,export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=(...args)=>globalThis.__projectWorkItemListCall(...args)', shortCircuit: true }
    if (specifier.endsWith('/platformBundleAuthorization')) return { url: 'data:text/javascript,export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{projects:["view"]}})', shortCircuit: true }
    if (specifier.endsWith('/projectCommandAuthorization')) return { url: 'data:text/javascript,export const loadProjectCommandAuthorization=async()=>{throw new Error("unused")}', shortCircuit: true }
    if (specifier === './enterpriseAimsProjects') return { url: 'data:text/javascript,export const enterpriseAimsProjectScope=async()=>({current_user_project_codes:"PRJ-1"});export const enterpriseAimsNestedProjectReadPermit=async(_e,u,id)=>({query:{},authorization:{projectId:id,actorUid:u.uid}})', shortCircuit: true }
    if (specifier.startsWith('@hzy/foundation/')) {
      const candidate = resolve(import.meta.dirname, '../../foundation', specifier.slice('@hzy/foundation/'.length))
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  let server
  try {
    const { enterpriseAimsProjectWorkItems } = await import('../server/utils/enterpriseAimsProjectWorkspace.ts')
    const app = createApp()
    const router = createRouter()
    router.get('/projects/:id/work-items', enterpriseAimsProjectWorkItems)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const get = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)

    // plan.vue：只带 milestone_id。
    assert.equal((await get('/projects/266/work-items?milestone_id=151')).status, 200)
    assert.equal(calls.at(-1).op, 'aims.project-work-item-list')
    assert.equal(calls.at(-1).input.projectId, '266')
    assert.deepEqual(calls.at(-1).input.query, { milestone_id: '151', current_user_project_codes: 'PRJ-1' })
    // workItem store：fetchBoardItems 不带分页；fetchItems 用 page + page_size；看板分页用 pageSize。
    assert.equal((await get('/projects/266/work-items?view=board&milestoneId=151&tier=target')).status, 200)
    assert.equal((await get('/projects/266/work-items?type=bug&status=todo&milestoneId=__null__&assignee_uid=U2&version_id=3&page=2&page_size=50&tier=target')).status, 200)
    assert.equal((await get('/projects/266/work-items?view=board&status=todo&page=1&pageSize=20&quickFilter=my_assigned')).status, 200)
    // ProjectNavbar / releases / timesheet。
    assert.equal((await get('/projects/266/work-items?type=requirement&tier=target&pageSize=1')).status, 200)
    assert.equal((await get('/projects/266/work-items?search=abc&pageSize=100&tier=matter')).status, 200)
    const accepted = calls.length

    for (const invalid of [
      '/projects/266/work-items?page=0',
      '/projects/266/work-items?page_size=101',
      '/projects/266/work-items?pageSize=20&page_size=20',
      '/projects/266/work-items?milestone_id=',
      `/projects/266/work-items?search=${'x'.repeat(201)}`,
      '/projects/266/work-items?milestone_id=1&milestone_id=2',
      '/projects/266/work-items?quickFilter=everyone',
      // 身份与范围只能由 Host 从已验证会话推导。
      '/projects/266/work-items?current_user=U9',
      '/projects/266/work-items?operator_uid=U9',
      '/projects/266/work-items?current_user_project_codes=PRJ-9',
      '/projects/0/work-items'
    ]) {
      assert.equal((await get(invalid)).status, 400, invalid)
    }
    assert.equal(calls.length, accepted, 'rejected queries must not reach Runtime')
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__projectWorkItemListCall
  }
})

test('every project work-item list key the Host accepts is also accepted by the Runtime delegated spec', () => {
  const bff = readFileSync(new URL('../server/utils/enterpriseAimsProjectWorkspace.ts', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../../data-runtime/internal/server/enterprise_project_workspace.go', import.meta.url), 'utf8')
  const hostKeys = [...bff.match(/const workItemListKeys = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  const listSpec = runtime.slice(runtime.indexOf('enterpriseProjectWorkItemListSpec'))
  const runtimeKeys = new Set([...listSpec.slice(0, listSpec.indexOf('Target:')).matchAll(/"([A-Za-z_]+)"/g)].map(m => m[1]))
  for (const key of hostKeys) assert.ok(runtimeKeys.has(key), `Runtime must accept ${key}`)
  assert.ok(hostKeys.includes('milestone_id'))
})
