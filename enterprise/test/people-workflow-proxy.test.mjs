import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('People proxy keeps the exact business tuple, scoped visibility and Workflow decision gates', async () => {
  const code = 'ASN-' + 'a'.repeat(32)
  const state = { query: {}, visible: true, initiator: 'other', biz: code, calls: [] }
  globalThis.__peopleProxy = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3')
      source = `export const createError=x=>Object.assign(Error(x.message||'error'),x);export const getHeader=()=> 'same-key';export const getQuery=()=>globalThis.__peopleProxy.query;export const getRouterParam=()=> '39';export const readBody=async()=>({comment:'approved'});export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient'))
      source = `export const requireEnterpriseUser=async()=>({uid:'actor'})`
    if (specifier.endsWith('/platformBundleAuthorization'))
      source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:[]})`
    if (specifier.endsWith('/authorizationActions'))
      source = `export const authorizationResourcesAllow=()=>true`
    if (specifier.endsWith('/serviceOidc'))
      source = `export const requestServiceAccessToken=async()=> 'fixture';export const trustedServiceRequestHeaders=()=>({})`
    if (specifier.endsWith('/workflowRuntime'))
      source = `export const resolveWorkflowApiUrl=async()=> 'https://fixture.invalid/workflow'`
    if (specifier.endsWith('/workflowProxyError'))
      source = `export const workflowProxyErrorData=e=>({statusCode:e.statusCode||503})`
    if (specifier.endsWith('/externalFetch'))
      source = `export const fetchExternal=async(url,opts)=>globalThis.__peopleProxy.fetch(url,opts)`
    if (specifier === './enterprisePeople')
      source = `export const readEnterprisePeopleAssignmentByCode=async(e,code)=>{globalThis.__peopleProxy.reads.push(code);if(!globalThis.__peopleProxy.visible)throw Object.assign(Error('denied'),{statusCode:403});return {id:1,employee_uid:'employee',change_type:'transfer',dept_name:'部门',position_name:'岗位',effective_from:'2026-10-04'}}`
    if (specifier === './enterpriseAltocReads')
      source = `export const enterpriseAltocRead=async()=>{}`
    if (specifier === './enterpriseFinanceLedger')
      source = `export const callFinanceLedger=async()=>{};export const normalizeFinanceLedgerRequest=()=>({})`
    if (specifier === './enterpriseAimsProjects')
      source = `export const projectRead=async()=>{}`
    if (specifier === './enterpriseAimsWorkItems')
      source = `export const enterpriseAimsWorkflowItem=async()=>{}`
    if (source)
      return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    if (specifier.endsWith('/optionalReadPagination'))
      return { url: new URL('../../foundation/shared/utils/optionalReadPagination.ts', import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  } })
  const old = process.env.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED
  delete process.env.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED
  state.reads = []
  state.fetch = async (url, opts) => {
    state.calls.push({ url, opts })
    const instance = { app_code: 'people', resource_code: 'assignments', action_code: 'change', biz_id: state.biz, initiator_uid: state.initiator, status: 'running' }
    if (url.includes('/tasks/pending'))
      return { data: { items: [{ ...instance, task_id: 39 }], total: 1, page: 1, pageSize: 20 } }
    if (url.includes('/tasks/39/approve'))
      return { code: 0, data: { approved: true } }
    if (url.includes('/tasks/39/reject'))
      return { code: 0, data: { rejected: true } }
    if (url.includes('/tasks/39'))
      return { data: { instance, task: { id: 39, assignee_uid: 'actor', status: 'pending' }, capabilities: { can_approve: true, can_reject: true } } }
    return { data: { instance } }
  }
  try {
    const { enterpriseWorkflowProxy: run } = await import('../server/utils/enterpriseWorkflowProxy.ts')
    state.query = { app_code: 'people', resource_code: 'assignments', action_code: 'change' }
    assert.equal((await run({}, 'pending')).data.total, 1)
    assert.equal(state.reads.length, 0)
    state.query.action_code = 'unknown'
    await assert.rejects(run({}, 'pending'), { statusCode: 403 })
    state.query = {}
    assert.equal((await run({}, 'task')).data.instance.people_summary.href, '/people/assignments/1')
    state.visible = false
    await assert.rejects(run({}, 'task'), { statusCode: 403 })
    await assert.rejects(run({}, 'approve'), { statusCode: 403 })
    state.visible = true
    state.initiator = 'actor'
    await assert.rejects(run({}, 'approve'), { statusCode: 403 })
    state.initiator = 'other'
    for (const bad of ['1', 'ASN-' + 'A'.repeat(32), code + ' ', 'ASN-abc']) {
      state.biz = bad
      await assert.rejects(run({}, 'task'), { statusCode: 400 })
    }
    state.biz = code
    assert.equal((await run({}, 'approve')).data.approved, true)
    assert.equal(state.calls.at(-1).opts.headers.get('idempotency-key'), 'same-key')
    assert.equal((await run({}, 'reject')).data.rejected, true)
    for (const op of ['by-biz', 'history']) {
      state.query = { app_code: 'people', resource_code: 'assignments', biz_id: code, ...op === 'by-biz' ? { action_code: 'change' } : {} }
      await run({}, op)
      state.visible = false
      await assert.rejects(run({}, op), { statusCode: 403 })
      state.visible = true
    }
    state.query = {}
    await run({}, 'instance')
    state.visible = false
    await assert.rejects(run({}, 'instance'), { statusCode: 403 })
  } finally {
    hooks.deregister()
    delete globalThis.__peopleProxy
    if (old === undefined)
      delete process.env.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED; else
      process.env.HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED = old
  }
})

test('People task summary links only to the server-authorized assignment', async () => {
  const { readFileSync } = await import('node:fs')
  const { parse, compileScript, compileTemplate } = await import('@vue/compiler-sfc')
  const source = readFileSync(new URL('../app/pages/enterprise/approvals/[id].vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'people-approval' })
  const result = compileTemplate({ source: descriptor.template.content, filename: '[id].vue', id: 'people-approval', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(result.errors, [])
  for (const field of ['employee', 'changeType', 'department', 'position', 'effectiveDate', 'href'])
    assert.ok(source.includes(`people_summary.${field}`))
  assert.match(source, /assignmentChangeLabels/)
  assert.doesNotMatch(source, /form_data\.id/)
})
