import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'

// 周报设置 Host 桥：只按已验证会话的 weekly_reports:configure 放行，
// 配置标志由宿主写入（浏览器自带同名参数被丢弃），人员许可固定为
// weekly-reporting-settings/configure；整体替换必须带同意图 Idempotency-Key。

const root = resolve(import.meta.dirname, '../..')
const valid = {
  timezone: 'Asia/Shanghai',
  deadlineWeekday: 5,
  deadlineTime: '18:00',
  summaryTargetWeekday: 1,
  summaryTargetTime: '10:00:00',
  rolloutMode: 'pilot',
  reminderOffsets: [],
  ragConfig: {}
}

test('weekly reporting settings Host bridge gates on configure and injects the flag server-side', async () => {
  const state = { resources: {}, runtimeCalls: [] }
  globalThis.__weeklySettings = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>1234;export const callEnterpriseRuntime=async(_e,operation,input,options)=>{globalThis.__weeklySettings.runtimeCalls.push({operation,input,options});return {code:0,data:{configured:true}}}'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__weeklySettings.resources,actionPolicies:{}})'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const mod = await import('../server/utils/enterpriseAimsWeeklyReportingSettings.ts')
    const router = createRouter()
    router.get('/settings', mod.enterpriseAimsWeeklyReportingSettings)
    router.put('/settings', mod.enterpriseAimsWeeklyReportingSettingsUpdate)
    const app = createApp()
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const get = (query = '') => fetch(`${base}/settings${query}`)
    const put = (body, key = 'b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', query = '') => fetch(`${base}/settings${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body)
    })
    const reset = () => {
      state.runtimeCalls.length = 0
    }
    const permit = { actorUid: 'U1', tenant: 'T1', deployment: 'host', resource: 'weekly-reporting-settings', action: 'configure', expiresAt: 1234 }

    // 1. 缺 configure（含 review/admin 等其他周报或管理权限）：403 且不调用 Runtime。
    for (const resources of [{}, { weekly_reports: ['view', 'review', 'submit', 'publish'] }, { admin: ['admin'], reports: ['admin'] }]) {
      state.resources = resources
      reset()
      assert.equal((await get()).status, 403)
      assert.equal((await put(valid)).status, 403)
      assert.equal(state.runtimeCalls.length, 0)
    }

    // 2. 读取：浏览器伪造的治理标志与 actor 被丢弃，宿主写入 1，许可固定 configure。
    state.resources = { weekly_reports: ['configure'] }
    reset()
    let response = await get('?current_user_can_configure_weekly_reports=0&current_user=U9&currentUserIsProjectDirector=1')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(state.runtimeCalls, [{
      operation: 'aims.weekly-reporting-settings-view',
      input: { tenant: 'T1', deployment: 'host', query: { current_user_can_configure_weekly_reports: '1' }, authorization: permit },
      options: {}
    }])
    reset()
    assert.equal((await get('?page=1')).status, 400)
    assert.equal(state.runtimeCalls.length, 0)

    // 3. 更新：白名单整体替换，稳定操作标识派生 Runtime 幂等键。
    reset()
    response = await put({ ...valid }, 'b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '?current_user_can_configure_weekly_reports=0')
    assert.equal(response.status, 200)
    assert.equal(state.runtimeCalls.length, 1)
    assert.equal(state.runtimeCalls[0].operation, 'aims.weekly-reporting-settings-update')
    assert.deepEqual(state.runtimeCalls[0].input, { tenant: 'T1', deployment: 'host', query: { current_user_can_configure_weekly_reports: '1' }, payload: valid, authorization: permit })
    assert.deepEqual(state.runtimeCalls[0].options, { idempotencyKey: 'aims.weekly-reporting-settings:b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })

    // 同一操作标识重试得到同一 Runtime 键；不带 reminder/RAG 时不补默认值。
    reset()
    const minimal = Object.fromEntries(Object.entries(valid).filter(([field]) => field !== 'reminderOffsets' && field !== 'ragConfig'))
    assert.equal((await put(minimal)).status, 200)
    assert.deepEqual(state.runtimeCalls[0].input.payload, minimal)
    assert.equal(state.runtimeCalls[0].options.idempotencyKey, 'aims.weekly-reporting-settings:b1a2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')

    // 4. 缺失/非法操作标识、未知字段、伪造 actor、越界值：400 且不调用 Runtime。
    for (const [body, key] of [
      [valid, ''],
      [valid, 'short'],
      [valid, 'bad key with spaces!!'],
      [{ ...valid, current_user: 'U9' }, undefined],
      [{ ...valid, configVersion: 3 }, undefined],
      [{ ...valid, deadlineWeekday: 0 }, undefined],
      [{ ...valid, summaryTargetWeekday: '1' }, undefined],
      [{ ...valid, deadlineTime: '24:00' }, undefined],
      [{ ...valid, rolloutMode: 'all' }, undefined],
      [{ ...valid, timezone: '../etc' }, undefined],
      [{ ...valid, reminderOffsets: '[]' }, undefined],
      [{ ...valid, ragConfig: [] }, undefined],
      [{ ...valid, ragConfig: { blob: 'x'.repeat(5000) } }, undefined],
      [[valid], undefined]
    ]) {
      reset()
      response = await put(body, key)
      assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80) + String(key))
      assert.equal(state.runtimeCalls.length, 0)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__weeklySettings
  }
})

test('weekly reporting settings routes are registered for exactly GET and PUT', () => {
  const settings = businessApiRoutes.filter(([, path]) => path === '/aims/api/v1/admin/weekly-reporting-settings')
  assert.deepEqual(settings.map(([method]) => method).sort(), ['GET', 'PUT'])
  const client = readFileSync(resolve(root, 'foundation/server/utils/enterpriseRuntimeClient.ts'), 'utf8')
  assert.match(client, /'aims\.weekly-reporting-settings-view': \{ path: '\/v1\/enterprise\/aims\/weekly-reporting-settings:view' \}/)
  assert.match(client, /'aims\.weekly-reporting-settings-update': \{ path: '\/v1\/enterprise\/aims\/weekly-reporting-settings:update' \}/)
})
