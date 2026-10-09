import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const root = resolve(import.meta.dirname, '../..')
test('R1a ten fixed operations and restored component templates keep review results server-owned', () => {
  const client = readFileSync(resolve(root, 'foundation/server/utils/enterpriseRuntimeClient.ts'), 'utf8')
  for (const suffix of ['target-list', 'spec-view', 'create', 'content-create', 'import', 'update', 'delete', 'content-update', 'content-delete', 'content-restore']) assert.ok(client.includes(`'aims.project-requirement-${suffix}'`))
  for (const name of ['aims/layer/pages/enterprise-project-requirements.vue', 'aims/app/components/requirements/spec/ChapterPreview.vue', 'aims/app/components/requirements/spec/CreateRequirementModal.vue', 'aims/app/components/requirements/import/Wizard.vue']) {
    const { descriptor, errors } = parse(readFileSync(resolve(root, name), 'utf8'), { filename: name })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'r1a' })
    const template = compileTemplate({ id: 'r1a', source: descriptor.template.content, filename: name, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], name)
  }
  const page = readFileSync(resolve(root, 'aims/layer/pages/enterprise-project-requirements.vue'), 'utf8')
  assert.match(page, /:allow-changes="false"/)
  assert.match(page, /结果由 Workflow 服务端回写/)
  assert.match(page, /syncBatch\(batch\)/)
  assert.doesNotMatch(page, /onApproved/)
})

test('typed R1a writes check permit and source ACL before dispatch, including replay', async () => {
  const { registerHooks } = await import('node:module')
  const { existsSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const calls = []
  globalThis.__r1a = { calls, permit: true, source: true }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/owningModuleHttp')) source = 'export const owningCreateError=x=>Object.assign(new Error(x.message),x)'
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>({uid:"actor",tenant:"T",deployment:"host"});export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(...args)=>{globalThis.__r1a.calls.push(args);return {code:0}}'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{requirements:["view"]},actionPolicies:{}})'
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=()=>true'
    if (specifier.endsWith('/projectCommandAuthorization')) source = 'export const loadProjectCommandAuthorization=async()=>{if(!globalThis.__r1a.permit)throw Object.assign(new Error("denied"),{statusCode:403});return {resource:"requirements",action:"edit",allowed:true}}'
    if (specifier.endsWith('/codocsApi')) source = 'export const getCodocsProjectDocumentContent=async()=>{if(!globalThis.__r1a.source)throw Object.assign(new Error("denied"),{statusCode:403})}'
    if (specifier.endsWith('/projectDocumentPorts')) source = 'export const hostProjectDocumentContext=async()=>({isMember:true,projectCode:"P263"})'
    if (specifier.endsWith('/projectDocumentSources')) source = 'export const readHostProjectDocumentSource=async()=>{if(!globalThis.__r1a.source)throw Object.assign(new Error("denied"),{statusCode:403})}'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { writeHostProjectRequirement } = await import('../../aims/layer/server/internal/projectRequirements.ts')
    const provider = async () => ({ authorization: {}, query: {} })
    const payload = { source: 'codocs', codocsUuid: '12345678-1234-4234-9234-123456789abc', docName: '规格书', items: [] }
    await writeHostProjectRequirement({}, provider, 'import', '263', '', payload, 'same-key', {})
    assert.equal(calls[0][1], 'aims.project-requirement-import')
    assert.equal(calls[0][2].authorization.resource, 'requirements')
    assert.equal(calls[0][3].idempotencyKey, 'same-key')
    globalThis.__r1a.source = false
    await assert.rejects(writeHostProjectRequirement({}, provider, 'import', '263', '', payload, 'same-key', {}), { statusCode: 403 })
    globalThis.__r1a.permit = false
    await assert.rejects(writeHostProjectRequirement({}, provider, 'create', '263', '', { title: 'x' }, 'new-key', {}), { statusCode: 403 })
    globalThis.__r1a.permit = true
    await assert.rejects(writeHostProjectRequirement({}, provider, 'update', '263', '4', { status: 'baselined' }, 'new-key', {}), { statusCode: 400 })
    assert.equal(calls.length, 1)
  } finally {
    hooks.deregister()
    delete globalThis.__r1a
  }
})

test('requirement intent retries keep the key, changed payload gets a new key and Host binds project', async () => {
  const { registerHooks } = await import('node:module')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/useAimsModule')) return { url: 'data:text/javascript,export const useAimsModule=()=>({hosted:true,moduleUrl:p=>"/enterprise/aims"+p})', shortCircuit: true }
    return next(specifier, context)
  } })
  const oldFetch = globalThis.$fetch
  const calls = []
  let fail = true
  globalThis.$fetch = async (path, options) => {
    calls.push({ path, options })
    if (fail) throw Error('response lost')
    return { code: 0 }
  }
  try {
    const { useRequirementIntent } = await import('../../aims/app/composables/useRequirementIntent.ts')
    const { mutate } = useRequirementIntent()
    await assert.rejects(mutate('/api/v1/requirements/4', 'PATCH', { title: 'x' }, 263))
    fail = false
    await mutate('/api/v1/requirements/4', 'PATCH', { title: 'x' }, 263)
    await mutate('/api/v1/requirements/4', 'PATCH', { title: 'y' }, 263)
    assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key'])
    assert.notEqual(calls[1].options.headers['Idempotency-Key'], calls[2].options.headers['Idempotency-Key'])
    assert.equal(calls[0].options.body.projectId, 263)
    assert.equal(calls[0].path, '/enterprise/aims/api/v1/requirements/4')
  } finally {
    hooks.deregister()
    globalThis.$fetch = oldFetch
  }
})
