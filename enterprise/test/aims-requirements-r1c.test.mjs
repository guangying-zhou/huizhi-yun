import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const text = path => readFileSync(resolve(root, path), 'utf8')

test('R1c owns results at verified callback and keeps Aims independent of Workflow imports', () => {
  const client = text('foundation/server/utils/enterpriseRuntimeClient.ts')
  for (const op of ['review-sync', 'review-create-tasks']) assert.ok(client.includes(`'aims.project-requirement-${op}': { path: '/v1/enterprise/aims/project-requirements:${op}' }`))
  const callback = text('data-runtime/internal/apps/aims/requirement_review_workflow.go')
  assert.match(callback, /beginBoundEnterpriseTransaction/)
  assert.match(callback, /workflow_callback_verified/)
  assert.match(callback, /validateReviewWorkflowInstance/)
  assert.match(callback, /firstBodyText\(instance, "status"\) != status/)
  assert.match(callback, /workflowInstanceReader\.ReadAimsRequirementReviewInstance/)
  assert.doesNotMatch(callback, /internal\/apps\/workflow/)
  const page = text('aims/layer/pages/enterprise-project-requirements.vue')
  assert.match(page, /sync-workflow/)
  assert.match(page, /create-tasks/)
  assert.doesNotMatch(page, /onApproved|\/approve|\/reject/)
  assert.ok(text('enterprise/composition/business-api-routes.generated.mjs').includes('/aims/api/v1/requirement-reviews/:batchId/sync-workflow'))
})

test('Host review submission uses frozen Runtime form, creates once, then freshly authorizes reconciliation', async () => {
  const state = { calls: [], reads: 0, created: false, input: { projectId: '263' }, forged: false, failAfterCreate: false }
  globalThis.__r1c = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error(x.message),x); export const getHeader=()=> 'stable-key'; export const getQuery=()=>({});export const getRouterParam=()=> '9';export const readBody=async()=>globalThis.__r1c.input;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'host'})`
    if (specifier.endsWith('/aims/layer/server/index')) source = `export const writeHostProjectRequirement=async(...args)=>{const s=globalThis.__r1c;s.calls.push(['sync',args]);s.reads++;if(s.failAfterCreate&&s.created){s.failAfterCreate=false;throw new Error('response lost')}return {code:0,data:{batchId:9,projectId:263,title:'Review',actionCode:'requirement_baseline',synced:s.created,workflowInstanceId:s.created?'42':'',formData:{projectId:'263',batchId:'9',requestedBy:s.forged?'forged':'actor',snapshotHash:'a'.repeat(64),requestNo:'RRB-9-'+ 'a'.repeat(64)}}}}`
    if (specifier.endsWith('/enterpriseAimsProjectDocumentPermits')) source = 'export const enterpriseAimsDocumentReadPermitProvider=()=>async()=>({})'
    if (specifier.endsWith('/enterpriseAimsProjects')) source = `export const enterpriseAimsProjectScope=async()=>({})`
    if (specifier.endsWith('/enterpriseWorkflowProxy')) source = `export const workflowRequest=async(...args)=>{const s=globalThis.__r1c;s.calls.push(['workflow',args]);if(args[2]==='instances/prepare')return {code:0,data:{action_def:{id:1,resource_code:'requirements',action_code:'requirement_baseline'},matched_routes:[{id:2}]}};s.created=true;return {code:0,data:{instance_id:42}}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let path
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAimsRequirementReviewSync } = await import('../server/utils/enterpriseAimsRequirementReviewWorkflow.ts')
    state.failAfterCreate = true
    await assert.rejects(() => enterpriseAimsRequirementReviewSync({}))
    const result = await enterpriseAimsRequirementReviewSync({})
    assert.equal(result.data.workflowInstanceId, '42')
    assert.equal(state.calls.filter(c => c[0] === 'workflow' && c[1][2] === 'instances').length, 1)
    assert.equal(state.reads, 3)
    const create = state.calls.find(c => c[0] === 'workflow' && c[1][2] === 'instances')[1][3]
    assert.equal(create.key, 'RRB-9-' + 'a'.repeat(64))
    assert.equal(create.body.form_data.requestedBy, 'actor')
    for (const call of state.calls.filter(c => c[0] === 'sync')) assert.deepEqual(call[1][5], {})
    state.input = { projectId: '263', status: 'approved' }
    await assert.rejects(() => enterpriseAimsRequirementReviewSync({}), { statusCode: 400 })
    state.input = { projectId: '263' }
    state.created = false
    state.forged = true
    const before = state.calls.filter(c => c[0] === 'workflow').length
    await assert.rejects(() => enterpriseAimsRequirementReviewSync({}), { statusCode: 503 })
    assert.equal(state.calls.filter(c => c[0] === 'workflow').length, before)
  } finally {
    hooks.deregister()
    delete globalThis.__r1c
  }
})
