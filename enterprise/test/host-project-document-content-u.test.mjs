import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const state = { calls: [], codocs: [], deny: false, mismatch: false }
const user = { uid: 'U1', tenant: 'C000001', deployment: 'C000001-enterprise' }
const uuid = '22222222-2222-4222-8222-222222222222'
globalThis.__contentU = { state, user, uuid }
const hooks = registerHooks({ resolve(specifier, context, next) {
  let source
  if (specifier.endsWith('/owningModuleHttp')) source = 'export const owningCreateError=x=>Object.assign(Error(x.message),x)'
  if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const requireEnterpriseUser=async()=>globalThis.__contentU.user;export const callEnterpriseRuntime=async(event,operation,input)=>{const {state,user,uuid}=globalThis.__contentU;state.calls.push({operation,input});if(state.deny)throw Object.assign(Error('denied'),{statusCode:403});return {code:0,data:operation==='aims.project-view'?{id:1,project_code:'P1',created_by:'U1',dept_code:null,leader_uid:'U1',members:[]}:{isMember:true,projectCode:'P1',documentUuid:state.mismatch?'wrong':uuid,title:'spec'}}}`
  if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{projects:["view"]}});export const loadScopedAuthorizationFromConsoleRuntime=async()=>({decision:{allowed:false}})'
  if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=()=>true'
  if (specifier.endsWith('/projectCommandAuthorization')) source = 'export const loadProjectCommandAuthorization=()=>{}'
  if (specifier.endsWith('/gitIntegration')) source = 'export const getGitRepositoryFile=async input=>{globalThis.__contentU.state.codocs.push(input);return {content:"spec",path:input.path,commitId:"fixed",lastCommitId:"fixed",blobId:"blob"}};export const listGitMarkdownTree=async input=>{globalThis.__contentU.state.codocs.push(input);return []}'
  if (specifier.endsWith('/codocsApi')) source = 'export const searchDepartmentDocuments=()=>{};export const searchProjectDocuments=()=>{};export const getCodocsProjectDocumentContent=async input=>{globalThis.__contentU.state.codocs.push(input);return {content:"spec"}}'
  if (specifier.endsWith('/aims/layer/server/index')) source = 'export const readHostProjectDocumentSource=(...args)=>globalThis.__contentU.readSource(...args);export const isValidHostGitRepositoryPath=value=>globalThis.__contentU.validRepo(value)'
  if (specifier.endsWith('/enterpriseAimsProjectDocumentPermits')) source = 'export const enterpriseAimsDocumentReadPermitProvider=()=>async projectId=>({query:{},authorization:{projectId}})'
  if (specifier === 'h3') source = 'export const createError=x=>Object.assign(Error(x.message),x);export const getQuery=e=>e.query;export const getRouterParam=(e,key,opts)=>opts?.decode?decodeURIComponent(e.params[key]):e.params[key];export const setHeader=()=>{}'
  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (!existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
  }
  return next(specifier, context)
} })
after(() => {
  hooks.deregister()
  delete globalThis.__contentU
})
{
  const { readHostProjectDocumentSource, isValidHostGitRepositoryPath } = await import('../../aims/layer/server/internal/projectDocumentSources.ts')
  globalThis.__contentU.readSource = readHostProjectDocumentSource
  globalThis.__contentU.validRepo = isValidHostGitRepositoryPath
  const { enterpriseAimsRepoDoc, enterpriseAimsRepoDocsTree } = await import('../server/utils/enterpriseAimsProjectDocumentSources.ts')
  const { readHostProjectDocumentContent } = await import('../../aims/layer/server/internal/projectDocumentContent.ts')
  test('project content uses fixed U context before Codocs, preserving actor and exact UUID', async () => {
    const provider = async projectId => ({ query: {}, authorization: { projectId } })
    state.calls = []
    state.codocs = []
    state.deny = false
    state.mismatch = false
    assert.deepEqual(await readHostProjectDocumentContent({}, provider, '1', uuid), { content: 'spec' })
    assert.deepEqual(state.calls.map(c => c.operation), ['aims.project-view', 'aims.project-document-context'])
    assert.equal(state.calls[1].input.documentUuid, uuid)
    assert.equal(state.calls[1].input.projectReadAuthorization.projectId, '1')
    assert.equal(state.calls[1].input.authorization.actorUid, 'U1')
    assert.equal(state.codocs[0].sourceApp, 'enterprise')
    state.codocs = []
    state.deny = true
    await assert.rejects(readHostProjectDocumentContent({}, provider, '1', uuid), { statusCode: 403 })
    assert.equal(state.codocs.length, 0)
    state.deny = false
    state.mismatch = true
    await assert.rejects(readHostProjectDocumentContent({}, provider, '1', uuid), { statusCode: 403 })
    assert.equal(state.codocs.length, 0)
  })
  test('repository doc/tree use project-bound U context before Git with exact repo relation', async () => {
    const provider = async projectId => ({ query: {}, authorization: { projectId } })
    for (const action of ['repo-doc', 'repo-tree']) {
      state.calls = []
      state.codocs = []
      state.deny = false
      state.mismatch = false
      await readHostProjectDocumentSource({}, provider, action, { projectId: '1', repoProjectCode: 'huizhi-yun/huizhiyun', ...(action === 'repo-doc' ? { path: 'docs/spec.md' } : {}) })
      assert.deepEqual(state.calls.map(c => c.operation), ['aims.project-view', 'aims.project-document-context'])
      assert.equal(state.calls[1].input.repoProjectCode, 'huizhi-yun/huizhiyun')
      assert.equal(state.calls[1].input.projectReadAuthorization.projectId, '1')
      assert.equal(state.codocs.length, 1)
      state.deny = true
      state.codocs = []
      await assert.rejects(readHostProjectDocumentSource({}, provider, action, { projectId: '2', repoProjectCode: 'huizhi-yun/huizhiyun', ...(action === 'repo-doc' ? { path: 'docs/spec.md' } : {}) }), { statusCode: 403 })
      assert.equal(state.codocs.length, 0)
    }
  })
  test('Host decodes GitLab namespace paths and rejects malformed paths before U/Git', async () => {
    state.deny = false
    state.mismatch = false
    for (const handler of [enterpriseAimsRepoDoc, enterpriseAimsRepoDocsTree]) {
      state.calls = []
      state.codocs = []
      await handler({ query: { aimsProjectId: '1', path: 'docs/spec.md' }, params: { projectCode: 'huizhi-yun%2Fhuizhiyun' } })
      assert.equal(state.calls[1].input.repoProjectCode, 'huizhi-yun/huizhiyun')
      assert.equal(state.codocs[0].repoPath, 'huizhi-yun/huizhiyun')
      for (const value of ['..', 'group/../repo', 'group//repo', '/group/repo', 'group/repo/', 'a'.repeat(256)]) {
        state.calls = []
        state.codocs = []
        await assert.rejects(async () => handler({ query: { aimsProjectId: '1', path: 'docs/spec.md' }, params: { projectCode: encodeURIComponent(value) } }), { statusCode: 400 })
        assert.equal(state.calls.length, 0)
        assert.equal(state.codocs.length, 0)
      }
    }
    for (const value of ['..', 'group//repo', '/group/repo', 'group/repo/', 'a'.repeat(256)]) {
      state.calls = []
      await assert.rejects(readHostProjectDocumentSource({}, async () => ({}), 'repo-doc', { projectId: '1', repoProjectCode: value, path: 'docs/spec.md' }), { statusCode: 400 })
      assert.equal(state.calls.length, 0)
    }
    assert.equal(isValidHostGitRepositoryPath('a'.repeat(255)), true)
    assert.equal(isValidHostGitRepositoryPath('group/subgroup/repo.git'), true)
  })
}
