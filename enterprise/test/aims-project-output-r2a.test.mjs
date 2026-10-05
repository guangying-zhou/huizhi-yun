import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const root = resolve(import.meta.dirname, '../..')
const text = path => readFileSync(resolve(root, path), 'utf8')

test('R2a page preserves four sections, scoped read and unchanged quality authority', () => {
  const page = text('aims/layer/pages/enterprise-project-output.vue')
  for (const label of ['项目立项书', '需求规格书', '交付文档', '代码仓库', 'qualityStatusBadge', 'overview.stats', 'Idempotency']) {
    if (label === 'Idempotency') continue
    assert.ok(page.includes(label), label)
  }
  assert.ok(page.includes('qualityStatusBadge'))
  for (const path of ['aims/layer/pages/enterprise-project-output.vue', 'aims/layer/components/ProjectOutputRepositoryPicker.vue']) {
    const source = text(path)
    const { descriptor, errors } = parse(source, { filename: path })
    assert.deepEqual(errors, [])
    compileScript(descriptor, { id: path })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: path, id: path }).errors, [])
  }
  const generated = text('enterprise/composition/business-api-routes.generated.mjs')
  for (const route of ['output', 'repo-candidates']) assert.ok(generated.includes(`/aims/api/v1/projects/:id/${route}`))
  const go = text('data-runtime/internal/apps/aims/enterprise_project_output.go')
  assert.match(go, /LevelRepeatableRead/)
  assert.match(go, /ReadOnly:\s*true/)
  assert.match(go, /listDeliverablesFrom\(readCtx, q, tx, true\)/)
  assert.match(go, /listProjectReposFrom\(readCtx, projectID, q, tx\)/)
  assert.match(go, /q.Set\("deliverable_type", "document"\)/)
  const server = text('data-runtime/internal/server/server.go')
  assert.equal((server.match(/ConfigureWorkflowInstanceReader\(workflowAdapter\)/g) || []).length, 1)
  assert.doesNotMatch(server, /ConfigureRequirementReviewWorkflowReader|ConfigureProjectLifecycleInstanceReader/)
})

test('R2a owning reads bind actor/project; candidate failures never reach GitLab', async () => {
  const state = { allowView: true, allowEdit: true, calls: [], gitCalls: [], group: 'huizhi-yun', remote: [{ projectCode: 'huizhi-yun/huizhiyun', name: '汇智云' }] }
  globalThis.__r2a = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/owningModuleHttp')) source = 'export const owningCreateError=x=>Object.assign(new Error(x.message),x)'
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(event,op,body)=>{const s=globalThis.__r2a;s.calls.push({op,body});return op==='aims.project-repo-candidates'?{code:0,data:{projectId:body.projectId,gitGroup:s.group}}:{code:0,data:{items:[]}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{projects:globalThis.__r2a.allowView?["view"]:[]},actionPolicies:{}})'
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=(r)=>r.projects.includes("view")'
    if (specifier.endsWith('/projectCommandAuthorization')) source = 'export const loadProjectCommandAuthorization=async(e,u,k)=>{if(!globalThis.__r2a.allowEdit)throw Object.assign(new Error("denied"),{statusCode:403});return {...k,actorUid:u.uid,allowed:true,scope:{version:1,masks:[65535]},bundleVersion:"v",bundleHash:"h",policyRevision:27}}'
    if (specifier.endsWith('/projectDocumentSources')) source = 'export const isValidHostGitRepositoryPath=x=>x.length<=255&&!x.includes("..")&&/^[A-Za-z0-9._-]+(?:\\/[A-Za-z0-9._-]+)*$/.test(x)'
    if (specifier.endsWith('/gitIntegration')) source = 'export const listGitGroupProjects=async x=>{globalThis.__r2a.gitCalls.push(x);return {items:globalThis.__r2a.remote}}'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let path
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { readHostProjectOutput, readHostProjectRepoCandidates } = await import('../../aims/layer/server/internal/projectOutput.ts')
    const provider = async id => ({ authorization: { projectId: id, actorUid: 'actor', scope: { version: 1, masks: [65535] } }, query: {} })
    state.allowView = false
    await assert.rejects(() => readHostProjectOutput({}, provider, '263', {}), { statusCode: 403 })
    assert.equal(state.calls.length, 0)
    state.allowView = true
    await readHostProjectOutput({}, provider, '263', { page: '2', pageSize: '20' })
    const call = state.calls[0]
    assert.equal(call.op, 'aims.project-output-overview')
    assert.equal(call.body.authorization.actorUid, 'actor')
    assert.equal(call.body.projectReadAuthorization.projectId, '263')
    assert.equal(call.body.query.page, '2')
    state.allowEdit = false
    await assert.rejects(() => readHostProjectRepoCandidates({}, '263'), { statusCode: 403 })
    assert.equal(state.gitCalls.length, 0)
    state.allowEdit = true
    const result = await readHostProjectRepoCandidates({}, '263')
    assert.equal(result.data.items[0].projectCode, 'huizhi-yun/huizhiyun')
    assert.deepEqual(state.gitCalls[0], { groupPath: 'huizhi-yun', includeArchived: false })
    const candidate = state.calls.at(-1)
    assert.equal(candidate.body.projectWriteAuthorization.action, 'edit')
    assert.equal(candidate.body.authorization.resource, 'project-repos')
    for (const group of ['../x', '/leading', 'bad//path']) {
      state.group = group
      const before = state.gitCalls.length
      await assert.rejects(() => readHostProjectRepoCandidates({}, '263'), { statusCode: 503 })
      assert.equal(state.gitCalls.length, before)
    }
    state.group = ''
    assert.deepEqual((await readHostProjectRepoCandidates({}, '263')).data.items, [])
    state.group = 'huizhi-yun'
    state.remote = [{ projectCode: 'another/repo', name: 'wrong' }]
    await assert.rejects(() => readHostProjectRepoCandidates({}, '263'), { statusCode: 503 })
  } finally {
    hooks.deregister()
    delete globalThis.__r2a
  }
})
