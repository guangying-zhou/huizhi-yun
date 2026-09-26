import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, createError, toNodeListener } from 'h3'

const root = resolve(import.meta.dirname, '../..')

test('hosted Workflow bridge rejects undeclared actions and fails closed before proxying', async () => {
  const calls = []
  let authenticated = true
  let visible = true
  let failed = false
  let uid = 'actor'
  let assignee = 'actor'
  let initiator = 'submitter'
  let taskStatus = 'pending'
  let qualified = true
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export async function requireEnterpriseUser(){if(!globalThis.__wfAuth())throw globalThis.__wfError(401);return {uid:globalThis.__wfUid(),tenant:'C000001'}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export async function loadAuthorizationSnapshotFromConsoleRuntime(){return {resources:[],actionPolicies:{workflow_tasks:{}}}}`
    if (specifier.endsWith('/authorizationActions')) source = `export function authorizationResourcesAllow(_resources,_resource,action){return globalThis.__wfQualified(action)}`
    if (specifier.endsWith('/serviceOidc')) source = `export async function requestServiceAccessToken(){return 'fixture-token'};export function trustedServiceRequestHeaders(){return {}}`
    if (specifier.endsWith('/workflowRuntime')) source = `export async function resolveWorkflowApiUrl(){return 'http://127.0.0.1:23140/workflow'}`
    if (specifier.endsWith('/workflowProxyError')) source = `export function workflowProxyErrorData(error){return {statusCode:error.statusCode||503,statusMessage:'Unavailable',message:'Workflow unavailable',code:'workflow_unavailable'}}`
    if (specifier.endsWith('/externalFetch')) source = `export async function fetchExternal(url,options){return globalThis.__wfFetch(url,options)}`
    if (specifier.endsWith('/enterpriseAimsWorkItems')) source = `export async function enterpriseAimsWorkflowItem(event,id,write){return globalThis.__wfItem(id,write)}`
    if (source) return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    return next(specifier, context)
  } })
  globalThis.__wfAuth = () => authenticated
  globalThis.__wfUid = () => uid
  globalThis.__wfQualified = () => qualified
  globalThis.__wfError = statusCode => createError({ statusCode })
  globalThis.__wfItem = (itemID) => {
    if (!visible) throw createError({ statusCode: 403 })
    if (itemID !== '308') throw createError({ statusCode: 404 })
    return { id: 308, projectId: 263, itemKey: 'D2-308', title: '标记工作项', status: 'in_progress' }
  }
  globalThis.useRuntimeConfig = () => ({ public: { deploymentPublicUrl: 'https://hzy0.isme.dev' } })
  const oldLocal = process.env.HZY0_LOCAL_ENTERPRISE
  const oldWorkflowUrl = process.env.HZY_WORKFLOW_API_URL
  process.env.HZY0_LOCAL_ENTERPRISE = 'true'
  process.env.HZY_WORKFLOW_API_URL = 'http://127.0.0.1:23140/workflow'
  globalThis.__wfFetch = async (url, options) => {
    const path = new URL(url).pathname
    calls.push({ path, method: options.method, body: options.body, key: options.headers.get('idempotency-key') })
    if (failed) throw { statusCode: 503 }
    if (path.endsWith('/instances/by-biz')) return { code: 0, data: null }
    if (path.endsWith('/tasks/pending')) return { code: 0, data: { total: 2, items: [
      { task_id: 11, app_code: 'aims', resource_code: 'tasks', action_code: 'complete', initiator_uid: initiator, biz_title: '冻结的目标标题' },
      { task_id: 12, app_code: 'aims', resource_code: 'projects', action_code: 'approve', initiator_uid: initiator, biz_title: '不应暴露' }
    ] } }
    if (path.endsWith('/tasks/11/approve')) {
      taskStatus = 'completed'
      return { code: 0, data: { task_id: 11, instance_id: 44 } }
    }
    if (path.endsWith('/tasks/11')) return { code: 0, data: {
      task: { id: 11, assignee_uid: assignee, status: taskStatus, node_name: '审批节点' },
      instance: { id: 44, app_code: 'aims', resource_code: 'tasks', action_code: 'complete', biz_id: '308', biz_title: '冻结的目标标题', initiator_uid: initiator, status: 'running', form_data: { summary: '提交时快照' } },
      capabilities: { can_approve: taskStatus === 'pending', can_reject: taskStatus === 'pending' }
    } }
    return { code: 0, data: { instance: { app_code: 'aims', resource_code: 'tasks', action_code: 'complete', biz_id: '308' } } }
  }
  let server
  try {
    const { enterpriseWorkflowProxy } = await import(pathToFileURL(resolve(root, 'enterprise/server/utils/enterpriseWorkflowProxy.ts')).href)
    const app = createApp()
    const router = createRouter()
    router.get('/instances/by-biz', event => enterpriseWorkflowProxy(event, 'by-biz'))
    router.get('/tasks/pending', event => enterpriseWorkflowProxy(event, 'pending'))
    router.get('/tasks/:id', event => enterpriseWorkflowProxy(event, 'task'))
    router.post('/tasks/:id/approve', event => enterpriseWorkflowProxy(event, 'approve'))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}`
    const byBiz = `${base}/instances/by-biz?app_code=aims&resource_code=tasks&action_code=complete&biz_id=308`
    let result = await fetch(byBiz)
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal((await result.json()).data, null)
    const before = calls.length
    process.env.HZY_WORKFLOW_API_URL = 'https://workflow.huizhi.yun/workflow'
    assert.equal((await fetch(byBiz)).status, 503)
    assert.equal(calls.length, before)
    process.env.HZY_WORKFLOW_API_URL = 'http://127.0.0.1:23140/workflow'
    assert.equal((await fetch(byBiz.replace('app_code=aims', 'app_code=finance'))).status, 403)
    assert.equal(calls.length, before)
    visible = false
    assert.equal((await fetch(byBiz)).status, 403)
    assert.equal(calls.length, before)
    result = await fetch(`${base}/tasks/pending`)
    assert.equal(result.status, 200)
    assert.deepEqual((await result.json()).data.items.map(item => item.task_id), [11])
    result = await fetch(`${base}/tasks/11`)
    assert.equal(result.status, 200)
    const snapshot = (await result.json()).data
    assert.equal(snapshot.instance.biz_title, '冻结的目标标题')
    assert.equal(snapshot.instance.form_data.summary, '提交时快照')
    assert.equal(snapshot.instance.biz_url, undefined)
    uid = 'outsider'
    assert.equal((await fetch(`${base}/tasks/11`)).status, 403)
    uid = 'submitter'
    assignee = 'submitter'
    assert.equal((await fetch(`${base}/tasks/11`)).status, 403)
    uid = 'actor'
    assignee = 'actor'
    qualified = false
    assert.equal((await fetch(`${base}/tasks/11`)).status, 403)
    qualified = true
    visible = true
    failed = true
    assert.equal((await fetch(byBiz)).status, 503)
    failed = false
    authenticated = false
    assert.equal((await fetch(byBiz)).status, 401)
    authenticated = true
    result = await fetch(`${base}/tasks/11/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-key' }, body: JSON.stringify({ comment: 'approved' }) })
    assert.equal(result.status, 200)
    const approve = calls.find(call => call.path.endsWith('/tasks/11/approve') && call.method === 'POST')
    assert.equal(approve.key, 'test-key')
    assert.equal((await fetch(`${base}/tasks/11/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'second-key' }, body: '{}' })).status, 409)
    taskStatus = 'pending'
    const beforeBadWrite = calls.length
    result = await fetch(`${base}/tasks/11/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-key' }, body: JSON.stringify({ comment: 'approved', current_user: 'attacker' }) })
    assert.equal(result.status, 400)
    assert.equal(calls.length, beforeBadWrite + 1)
  } finally {
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    hooks.deregister()
    for (const key of ['__wfAuth', '__wfUid', '__wfQualified', '__wfError', '__wfItem', '__wfFetch', 'useRuntimeConfig']) delete globalThis[key]
    if (oldLocal === undefined) delete process.env.HZY0_LOCAL_ENTERPRISE
    else process.env.HZY0_LOCAL_ENTERPRISE = oldLocal
    if (oldWorkflowUrl === undefined) delete process.env.HZY_WORKFLOW_API_URL
    else process.env.HZY_WORKFLOW_API_URL = oldWorkflowUrl
  }
})

test('Enterprise exposes only seven exact Workflow methods and paths', () => {
  const base = resolve(root, 'enterprise/server/routes/api/workflow-proxy')
  for (const path of [
    'instances/by-biz.get.ts', 'instances/by-biz-history.get.ts', 'instances/[id].get.ts',
    'tasks/[id].get.ts', 'tasks/pending.get.ts',
    'tasks/[id]/approve.post.ts', 'tasks/[id]/reject.post.ts'
  ]) assert.ok(existsSync(resolve(base, path)), path)
  for (const path of ['instances/prepare.post.ts', 'instances/index.post.ts']) assert.equal(existsSync(resolve(base, path)), false)
  const boundary = readFileSync(resolve(root, 'enterprise/server/middleware/02-workflow-boundary.ts'), 'utf8')
  assert.match(boundary, /Workflow operation is not registered in Enterprise/)
  assert.doesNotMatch(boundary, /\*\*|\.\.\.path/u)
  const panel = readFileSync(resolve(root, 'enterprise/app/components/HostWorkflowPanel.vue'), 'utf8')
  assert.match(panel, /completionKind\.value === 'matter' \? 'matter-completion' : 'completion'/u)
  assert.match(panel, /completion\?\.canRequest === true/u)
  assert.match(panel, /:instance-id="instanceId"/u)
  assert.doesNotMatch(panel, /createInstance|prepareInstance|onSubmitted|status:\s*'completed'/u)
  const approval = readFileSync(resolve(root, 'enterprise/app/pages/enterprise/approvals/[id].vue'), 'utf8')
  assert.match(approval, /instance\.form_data/u)
  assert.match(approval, /evidenceSummary/u)
  assert.doesNotMatch(approval, /\/aims\/api\/v1\/work-items/u)
})
