import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'

// 全局周报治理 Host 桥：项目总监标志与持有人 revision 只能由宿主按已验证会话
// + Console role-holders 推导（与独立 Aims BFF 同一 Foundation helper），
// 浏览器自带的同名参数不得进入 Runtime。

const root = resolve(import.meta.dirname, '../..')
const director = ['aims.weekly-report-review', 'aims.weekly-report-open-correction',
  'aims.company-weekly-summary-view', 'aims.company-weekly-summary-versions',
  'aims.company-weekly-summary-save-draft', 'aims.company-weekly-summary-generate',
  'aims.company-weekly-summary-publish', 'aims.company-weekly-summary-retry',
  'aims.company-weekly-summary-cancel-publish', 'aims.company-weekly-summary-open-correction']

function roleHolderResponse(uids, revision = 42) {
  return { code: 0, data: { roles: [{ roleCode: 'project_director', revision, status: uids.length === 1 ? 'resolved' : 'ambiguous', errorCode: uids.length === 1 ? null : 'role_holder_ambiguous', holders: uids.map(uid => ({ uid })) }] } }
}

test('weekly governance Host bridge derives project director context server-side', async () => {
  const state = {
    resources: {},
    holder: () => roleHolderResponse(['U1']),
    consoleCalls: [],
    tokenCalls: [],
    runtimeCalls: [],
    directoryCalls: [],
    view: { generated: true, recipientSelections: [] },
    runtimeResponse(operation) {
      if (operation === 'aims.company-weekly-summary-view') return { code: 0, data: state.view }
      if (operation === 'aims.company-weekly-summary-publish') return { code: 0, data: { status: 'publishing', operation: { operationKey: 'aims:company-weekly-summary:2026-W37:r1:publish:v1' } } }
      if (operation === 'aims.company-weekly-summary-retry') return { code: 0, data: { operationKey: 'aims:company-weekly-summary:2026-W37:r1:publish:v1', operationStatus: 'pending' } }
      return { code: 0, data: {} }
    },
    directory: () => ({ code: 0, data: [] })
  }
  globalThis.__weeklyGov = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"U1",tenant:"T1",deployment:"host"});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(_e,operation,input,options)=>{globalThis.__weeklyGov.runtimeCalls.push({operation,input,options});return globalThis.__weeklyGov.runtimeResponse(operation,input)}'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__weeklyGov.resources,actionPolicies:{}})'
    if (specifier.endsWith('/projectCommandAuthorization')) source = 'export const loadProjectCommandAuthorization=async()=>{throw new Error("unused")}'
    if (specifier === './enterpriseAimsProjects') source = 'export const enterpriseAimsProjectScope=async()=>({current_user_dept_codes:"D1"})'
    if (specifier.endsWith('/directoryApi')) source = 'export const fetchConsoleDirectoryApi=async(path,options)=>{globalThis.__weeklyGov.directoryCalls.push({path,params:options?.params});return globalThis.__weeklyGov.directory(path,options)}'
    if (specifier.endsWith('/serviceAppUrl')) source = 'export const resolveServiceAppBaseUrl=()=>"https://console.test"'
    if (specifier.endsWith('/serviceOidc')) source = 'export const requestServiceAccessToken=async(o)=>{globalThis.__weeklyGov.tokenCalls.push(o);return "svc"};export const trustedServiceRequestHeaders=()=>({"x-hzy-app-code":"console"});export const fetchConsoleServiceJson=async(_e,url,init)=>{globalThis.__weeklyGov.consoleCalls.push({url:String(url),init});return globalThis.__weeklyGov.holder()}'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  let server
  try {
    const mod = await import('../server/utils/enterpriseAimsWeeklyGovernance.ts')
    const router = createRouter()
    router.get('/weekly-reporting-periods/:periodKey/director-workbench', mod.enterpriseAimsWeeklyPeriodWorkbench)
    router.post('/weekly-reporting-periods/:periodKey', mod.enterpriseAimsWeeklyPeriodGenerate)
    router.post('/weekly-reports/:reportId', mod.enterpriseAimsWeeklyReportCommand)
    router.get('/company-weekly-summaries/:periodKey', mod.enterpriseAimsCompanyWeeklySummary)
    router.get('/company-weekly-summaries/:periodKey/versions', mod.enterpriseAimsCompanyWeeklySummaryVersions)
    router.put('/company-weekly-summaries/:periodKey/draft', mod.enterpriseAimsCompanyWeeklySummarySaveDraft)
    router.post('/company-weekly-summaries/:periodKey', mod.enterpriseAimsCompanyWeeklySummaryCommand)
    const app = createApp()
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const send = (method, path) => fetch(base + path, method === 'GET'
      ? {}
      : { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const requests = {
      'aims.weekly-report-review': ['POST', '/weekly-reports/9:review'],
      'aims.weekly-report-open-correction': ['POST', '/weekly-reports/9:open-correction'],
      'aims.company-weekly-summary-view': ['GET', '/company-weekly-summaries/2026-W37'],
      'aims.company-weekly-summary-versions': ['GET', '/company-weekly-summaries/2026-W37/versions'],
      'aims.company-weekly-summary-save-draft': ['PUT', '/company-weekly-summaries/2026-W37/draft'],
      'aims.company-weekly-summary-generate': ['POST', '/company-weekly-summaries/2026-W37:generate'],
      'aims.company-weekly-summary-publish': ['POST', '/company-weekly-summaries/2026-W37:publish'],
      'aims.company-weekly-summary-retry': ['POST', '/company-weekly-summaries/2026-W37:retry'],
      'aims.company-weekly-summary-cancel-publish': ['POST', '/company-weekly-summaries/2026-W37:cancel-publish'],
      'aims.company-weekly-summary-open-correction': ['POST', '/company-weekly-summaries/2026-W37:open-correction']
    }
    const reset = () => {
      state.consoleCalls.length = 0
      state.tokenCalls.length = 0
      state.runtimeCalls.length = 0
      state.directoryCalls.length = 0
    }

    // 1. 当前唯一项目总监：每条总监命令都带 flag + 新鲜 revision，读取持有人走精确 scope。
    state.resources = { reports: ['view', 'edit'], weekly_reports: ['review'] }
    for (const operation of director) {
      reset()
      const [method, path] = requests[operation]
      const response = await send(method, path)
      assert.equal(response.status, 200, operation)
      // 发布先读 Runtime 当前汇总取抄送选择，再发布；持有人仍只读一次。
      assert.deepEqual(state.runtimeCalls.map(item => item.operation), operation === 'aims.company-weekly-summary-publish'
        ? ['aims.company-weekly-summary-view', operation]
        : [operation], operation)
      const call = state.runtimeCalls.at(-1)
      assert.equal(call.input.query.current_user_is_project_director, '1')
      assert.equal(call.input.query.current_user_project_director_revision, '42')
      assert.equal(call.input.query.current_user_dept_codes, 'D1')
      assert.deepEqual(state.tokenCalls.map(t => [t.audience, t.scope]), [['console', 'console:authorization-role-holders:read']])
      assert.match(state.consoleCalls[0].url, /\/api\/v1\/console\/service\/authorization\/role-holders\?roleCodes=project_director$/)
    }

    // 2. 总监工作台：与独立 BFF 相同，只按 weekly_reports:review 放行，不读持有人、不带 revision；
    //    浏览器伪造的 flag/revision 被丢弃，筛选参数照常转发。
    reset()
    let response = await send('GET', '/weekly-reporting-periods/2026-W37/director-workbench?page=2&current_user_is_project_director=1&current_user_project_director_revision=999&currentUserIsProjectDirector=1')
    assert.equal(response.status, 200)
    assert.equal(state.consoleCalls.length, 0)
    assert.deepEqual(state.runtimeCalls[0].input.query, { page: '2', current_user_dept_codes: 'D1', current_user_is_project_director: '1' })

    // 3. 有 review 权限但不是当前持有人：宿主 403，Runtime 不被调用。
    state.holder = () => roleHolderResponse(['U2'])
    for (const operation of director) {
      reset()
      const [method, path] = requests[operation]
      response = await send(method, path)
      assert.equal(response.status, 403, operation)
      assert.equal(state.consoleCalls.length, 1, `${operation} is denied by the holder check`)
      assert.equal(state.runtimeCalls.length, 0, operation)
    }

    // 4. 没有 review 权限：伪造的 flag 不生效，宿主 403 且不读持有人、不调 Runtime。
    state.holder = () => roleHolderResponse(['U1'])
    state.resources = { reports: ['view', 'edit'], weekly_reports: ['view', 'submit'] }
    for (const [method, path] of [...Object.values(requests), ['GET', '/weekly-reporting-periods/2026-W37/director-workbench?current_user_is_project_director=1']]) {
      reset()
      response = await send(method, path)
      assert.equal(response.status, 403, path)
      assert.equal(state.consoleCalls.length, 0, path)
      assert.equal(state.runtimeCalls.length, 0, path)
    }

    // 5. 周期生成：配置权限单独即可（不读持有人）；仅总监时必须带持有人 revision；两者都无则 403。
    state.resources = { reports: ['edit'], weekly_reports: ['configure'] }
    reset()
    response = await send('POST', '/weekly-reporting-periods/2026-W37:generate')
    assert.equal(response.status, 200)
    assert.equal(state.consoleCalls.length, 0)
    assert.deepEqual(state.runtimeCalls[0].input.query, { current_user_dept_codes: 'D1', current_user_is_project_director: '0', current_user_can_configure_weekly_reports: '1' })
    assert.equal(state.runtimeCalls[0].options.idempotencyKey, 'weekly-period-generate:2026-W37')
    state.resources = { reports: ['edit'], weekly_reports: ['review'] }
    reset()
    response = await send('POST', '/weekly-reporting-periods/2026-W37:generate')
    assert.equal(response.status, 200)
    assert.deepEqual(state.runtimeCalls[0].input.query, { current_user_dept_codes: 'D1', current_user_is_project_director: '1', current_user_can_configure_weekly_reports: '0', current_user_project_director_revision: '42' })
    state.resources = { reports: ['edit'], weekly_reports: ['view'] }
    reset()
    response = await send('POST', '/weekly-reporting-periods/2026-W37:generate')
    assert.equal(response.status, 403)
    assert.equal(state.runtimeCalls.length, 0)

    // 5b. 公司汇总发布编排：抄送选择只取 Runtime 投影，经 Console 目录展开后才写入
    //     resolution 标志；浏览器自带的收件人、覆盖键与标志一律丢弃。
    state.resources = { reports: ['view', 'edit'], weekly_reports: ['review'] }
    state.view = {
      generated: true,
      recipientSelections: [
        { subjectType: 'user', subjectCode: 'U9', subjectName: '王九' },
        { subjectType: 'department', subjectCode: 'D2', subjectName: '交付部' }
      ]
    }
    state.directory = (path, options) => {
      if (path === '/users' && options?.params?.uids) return { code: 0, data: [{ uid: 'U9', realName: '王九', deptCode: 'D9' }] }
      if (path === '/departments') return { code: 0, data: { tree: [{ deptCode: 'D2', children: [{ deptCode: 'D2A' }] }] } }
      if (path === '/users' && options?.params?.dept_code === 'D2') return { code: 0, data: { items: [{ uid: 'U2', realName: '李二', deptCode: 'D2' }], total: 1 } }
      if (path === '/users' && options?.params?.dept_code === 'D2A') return { code: 0, data: { items: [{ uid: 'U9', realName: '王九', deptCode: 'D2A' }, { uid: 'U3', displayName: '张三', deptCode: 'D2A' }], total: 2 } }
      throw new Error(`unexpected directory call ${path}`)
    }
    const forged = {
      correctionReason: '  补充风险说明  ',
      resolvedRecipients: [{ subjectType: 'user', subjectCode: 'X', uid: 'X', displayName: 'forged' }],
      coveredSelectionKeys: ['user:X'],
      company_summary_recipient_resolution_verified: '1',
      hzy_runtime_tenant_code: 'other'
    }
    const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    reset()
    response = await post('/company-weekly-summaries/2026-W37:publish?company_summary_recipient_resolution_verified=1', forged)
    assert.equal(response.status, 200)
    const published = await response.json()
    assert.deepEqual(published.data.delivery, { linked: true, synced: false, pending: true })
    assert.equal(published.data.status, 'publishing')
    assert.deepEqual(state.runtimeCalls.map(item => item.operation), ['aims.company-weekly-summary-view', 'aims.company-weekly-summary-publish'])
    const [viewCall, publishCall] = state.runtimeCalls
    assert.equal(viewCall.input.authorization.action, 'view')
    assert.equal(viewCall.input.query.company_summary_recipient_resolution_verified, undefined)
    assert.equal(publishCall.input.authorization.action, 'edit')
    assert.equal(publishCall.input.query.company_summary_recipient_resolution_verified, '1')
    assert.equal(publishCall.options.idempotencyKey, 'aims.company-weekly-summary-publish:2026-W37')
    assert.deepEqual(publishCall.input.payload, {
      correctionReason: '补充风险说明',
      resolvedRecipients: [
        { subjectType: 'department', subjectCode: 'D2', uid: 'U2', displayName: '李二', departmentCode: 'D2' },
        { subjectType: 'department', subjectCode: 'D2', uid: 'U3', displayName: '张三', departmentCode: 'D2A' },
        { subjectType: 'user', subjectCode: 'U9', uid: 'U9', displayName: '王九', departmentCode: 'D9' }
      ],
      coveredSelectionKeys: ['department:D2', 'user:U9']
    })
    assert.equal(state.consoleCalls.length, 1, 'holder read once for view + publish')

    // 未生成草稿：不解析、不发布。
    state.view = { generated: false, recipientSelections: [] }
    reset()
    response = await post('/company-weekly-summaries/2026-W37:publish', {})
    assert.equal(response.status, 409)
    assert.deepEqual(state.runtimeCalls.map(item => item.operation), ['aims.company-weekly-summary-view'])
    assert.equal(state.directoryCalls.length, 0)

    // 抄送人员已不可用：409 且不发布。
    state.view = { generated: true, recipientSelections: [{ subjectType: 'user', subjectCode: 'U404', subjectName: '离职人员' }] }
    state.directory = () => ({ code: 0, data: [] })
    reset()
    response = await post('/company-weekly-summaries/2026-W37:publish', {})
    assert.equal(response.status, 409)
    assert.equal(state.runtimeCalls.some(item => item.operation === 'aims.company-weekly-summary-publish'), false)

    // 目录依赖故障：503（不伪装成缺权），不泄露内部诊断，不发布。
    state.directory = () => {
      throw Object.assign(new Error('connect ECONNREFUSED http://console.internal:3000'), { statusCode: 403 })
    }
    reset()
    response = await post('/company-weekly-summaries/2026-W37:publish', {})
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /console\.internal|ECONNREFUSED/)
    assert.equal(state.runtimeCalls.some(item => item.operation === 'aims.company-weekly-summary-publish'), false)

    // 重试/取消：不转发浏览器 payload；重试返回待后台投递状态。
    for (const [action, operation] of [['retry', 'aims.company-weekly-summary-retry'], ['cancel-publish', 'aims.company-weekly-summary-cancel-publish']]) {
      reset()
      response = await post(`/company-weekly-summaries/2026-W37:${action}`, forged)
      assert.equal(response.status, 200, action)
      assert.equal(state.runtimeCalls.length, 1, action)
      assert.equal(state.runtimeCalls[0].operation, operation)
      assert.deepEqual(state.runtimeCalls[0].input.payload, {}, action)
      assert.equal(state.runtimeCalls[0].input.query.company_summary_recipient_resolution_verified, undefined, action)
      if (action === 'retry') assert.deepEqual((await response.json()).data.delivery, { linked: true, synced: false, pending: true })
    }
    state.view = { generated: true, recipientSelections: [] }
    state.directory = () => ({ code: 0, data: [] })

    // 6. 持有人依赖不可用保持 503（不伪装成缺权 403）；0 人/多人为 409；Runtime 均不被调用。
    state.resources = { reports: ['view', 'edit'], weekly_reports: ['review'] }
    for (const [holder, status] of [
      [() => { throw Object.assign(new Error('down'), { statusCode: 502 }) }, 503],
      [() => { throw new Error('ECONNREFUSED') }, 503],
      [() => ({ code: 0, data: { roles: [{ roleCode: 'project_director', revision: 0, status: 'resolved', holders: [{ uid: 'U1' }] }] } }), 503],
      [() => roleHolderResponse([]), 409],
      [() => roleHolderResponse(['U1', 'U3']), 409]
    ]) {
      state.holder = holder
      reset()
      response = await send('POST', '/weekly-reports/9:review')
      assert.equal(response.status, status)
      assert.equal(state.runtimeCalls.length, 0)
    }
  } finally {
    if (server) await new Promise(done => server.close(done))
    hooks.deregister()
    delete globalThis.__weeklyGov
  }
})
