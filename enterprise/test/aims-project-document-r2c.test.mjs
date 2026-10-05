import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const state = { calls: [], git: [], external: [], parts: [], denied: false, changed: true, doc: {}, actor: 'U1' }
globalThis.__r2c = state
const hooks = registerHooks({ resolve(specifier, context, next) {
  let source
  if (specifier.endsWith('/owningModuleHttp') || specifier === 'h3') source = 'export const owningCreateError=x=>Object.assign(Error(x.message),x);export const createError=owningCreateError;export const getRouterParam=()=>"1";export const readBody=async()=>({});export const readMultipartFormData=async()=>globalThis.__r2c.parts;export const setHeader=()=>{}'
  if (specifier === './projectDocumentPorts') source = 'export const documentActor=async()=>({uid:globalThis.__r2c.actor});export const hostDocumentOwner=async()=>"1";export const hostProjectDocumentContext=async()=>{if(globalThis.__r2c.denied)throw Object.assign(Error("denied"),{statusCode:403});return {projectId:"1",projectCode:"P1",isManager:true,isMember:true,document:globalThis.__r2c.doc,documentRefType:"cabinet_file",documentUuid:"11111111-1111-4111-8111-111111111111"}};export const hostDocumentWrite=async(e,action,c,payload)=>{globalThis.__r2c.calls.push({action,payload});return {code:0,data:{id:1}}};export const documentEnvelope=x=>x.data'
  if (specifier.endsWith('/codocsApi')) source = 'export const createCodocsDocument=async x=>{globalThis.__r2c.external.push(x)};export const uploadCodocsProjectCabinetFile=async x=>{globalThis.__r2c.external.push(x);return {uuid:x.fileUuid,filename:x.fileName,ossPath:"codocs/projects/P1/cabinet/f.pdf",fileSize:x.data.length}};export const searchDepartmentDocuments=()=>{};export const searchProjectDocuments=()=>{}'
  if (specifier.endsWith('/gitIntegration')) source = 'export const getGitRepositoryFile=async x=>{globalThis.__r2c.git.push(x);return {path:x.path,commitId:x.commitId||"latest",lastCommitId:x.commitId||"latest",blobId:x.commitId||!globalThis.__r2c.changed?"old-blob":"new-blob",content:x.commitId?"fixed content":"latest content"}};export const listGitMarkdownTree=()=>{}'
  if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"U1"});export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const callEnterpriseRuntime=()=>{}'
  if (specifier.endsWith('/tenantRuntimeClient')) source = 'export const hashServiceCommandPayload=()=>{}'
  if (specifier.endsWith('/aims/layer/server/index')) return { url: new URL('../../aims/layer/server/internal/projectDocumentWrites.ts', import.meta.url).href, shortCircuit: true }
  if (specifier.endsWith('/enterpriseAimsProjectDocumentPermits')) source = 'export const enterpriseAimsDocumentReadPermitProvider=()=>async()=>({})'
  if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (!existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
  }
  return next(specifier, context)
} })
try {
  const { isValidProjectAttachmentSize, PROJECT_DOCUMENT_MAX_ATTACHMENT_BYTES: limit } = await import('../../aims/shared/projectDocumentRules.ts')
  const { writeHostProjectDocument } = await import('../../aims/layer/server/internal/projectDocumentWrites.ts')
  const { readHostProjectDocumentSource } = await import('../../aims/layer/server/internal/projectDocumentSources.ts')
  const { enterpriseAimsUploadProjectDocument } = await import('../server/utils/enterpriseAimsProjectDocumentWrites.ts')
  const provider = async () => ({})
  const uuid = '11111111-1111-4111-8111-111111111111'
  await test('100 MB boundary and actual Host upload above the former 10 MiB limit', async () => {
    assert.equal(limit, 100 * 1024 * 1024)
    assert.equal(isValidProjectAttachmentSize(limit), true)
    for (const n of [0, -1, limit + 1, NaN, 1.5]) assert.equal(isValidProjectAttachmentSize(n), false)
    const data = Buffer.alloc(11 * 1024 * 1024, 1)
    state.parts = [{ name: 'file', filename: 'test.pdf', data }, { name: 'documentUuid', data: Buffer.from(uuid) }]
    await enterpriseAimsUploadProjectDocument({})
    assert.equal(state.external.at(-1).data.length, data.length)
    assert.equal(state.calls.at(-1).payload.contentSize, data.length)
    state.external = []
    state.calls = []
    state.parts[0].data = { length: limit + 1 }
    await assert.rejects(enterpriseAimsUploadProjectDocument({}), { statusCode: 400 })
    assert.equal(state.external.length, 0)
    assert.equal(state.calls.length, 0)
    await assert.rejects(writeHostProjectDocument({}, provider, 'upload-file', { projectId: '1', documentUuid: uuid }, { fileName: 'x.pdf', contentBase64: 'invalid' }), { statusCode: 400 })
  })
  await test('cabinet reference deletion never calls Codocs content, attachment or grant deletion', async () => {
    state.doc = { createdBy: 'U1', ossPath: 'codocs/projects/P1/cabinet/f.pdf' }
    state.external = []
    state.calls = []
    await writeHostProjectDocument({}, provider, 'delete', { documentId: '1' })
    assert.deepEqual(state.calls, [{ action: 'delete', payload: {} }])
    assert.equal(state.external.length, 0)
    state.denied = true
    state.calls = []
    await assert.rejects(writeHostProjectDocument({}, provider, 'delete', { documentId: '1' }), { statusCode: 403 })
    assert.equal(state.calls.length, 0)
    assert.equal(state.external.length, 0)
    state.denied = false
  })
  await test('repository selection freezes an actual commit; preview returns only frozen bytes with separate update metadata', async () => {
    state.calls = []
    state.git = []
    state.changed = true
    await writeHostProjectDocument({}, provider, 'create-index', { documentUuid: uuid }, { projectId: 1, title: 'spec', documentSource: 'repo', repoProjectCode: 'group/repo', repoFilePath: 'docs/spec.md' })
    assert.equal(state.calls[0].payload.repoCommitId, 'latest')
    state.git = []
    const input = { projectId: '1', repoProjectCode: 'group/repo', path: 'docs/spec.md', commitId: 'fixed' }
    const response = await readHostProjectDocumentSource({}, provider, 'repo-doc', input)
    assert.equal(response.data.content, 'fixed content')
    assert.equal(response.data.commit_id, 'fixed')
    assert.equal(response.data.has_new_version, true)
    assert.equal(response.data.latest_commit_id, 'latest')
    assert.deepEqual(state.git.map(x => x.commitId), ['fixed', undefined])
    state.changed = false
    assert.equal((await readHostProjectDocumentSource({}, provider, 'repo-doc', input)).data.has_new_version, false)
    state.denied = true
    state.git = []
    await assert.rejects(readHostProjectDocumentSource({}, provider, 'repo-doc', input), { statusCode: 403 })
    assert.equal(state.git.length, 0)
    state.denied = false
  })
  await test('UI compiles and project member removal keeps Codocs grants independent', () => {
    for (const path of ['../../aims/app/pages/projects/[id]/documents.vue', '../../aims/app/components/AimsDocumentPreview.vue']) {
      const src = readFileSync(new URL(path, import.meta.url), 'utf8')
      const { descriptor, errors } = parse(src)
      assert.deepEqual(errors, [])
      const script = compileScript(descriptor, { id: 'r2c' })
      assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: path, id: 'r2c', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    }
    const preview = readFileSync(new URL('../../aims/app/components/AimsDocumentPreview.vue', import.meta.url), 'utf8')
    assert.match(preview, /有更新版本/)
    assert.match(preview, /has_new_version === true/)
    const member = readFileSync(new URL('../../data-runtime/internal/apps/aims/enterprise_project_member_write.go', import.meta.url), 'utf8')
    assert.match(member, /DELETE FROM aims_project_members/)
    assert.doesNotMatch(member, /codocs|document_shares|document_permissions|review_grants/i)
  })
} finally {
  hooks.deregister()
  delete globalThis.__r2c
}
