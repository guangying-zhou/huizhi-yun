import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const root = resolve(import.meta.dirname, '../..')
const reads = ['versions', 'change-diff', 'change-impact', 'review-list', 'review-resolve']
const writes = ['change-create', 'task-create', 'review-create', 'review-append', 'review-withdraw']
test('R1b adds exactly ten literal U operations and keeps Workflow results server-owned', () => {
  const client = readFileSync(resolve(root, 'foundation/server/utils/enterpriseRuntimeClient.ts'), 'utf8')
  for (const suffix of [...reads, ...writes]) {
    assert.ok(client.includes(`'aims.project-requirement-${suffix}': { path: '/v1/enterprise/aims/project-requirements:${suffix}' }`), suffix)
  }
  for (const file of ['aims/layer/pages/enterprise-project-requirements.vue', 'aims/app/components/requirements/task/CreateTaskDialog.vue']) {
    const { descriptor, errors } = parse(readFileSync(resolve(root, file), 'utf8'), { filename: file })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'r1b' })
    assert.deepEqual(compileTemplate({ id: 'r1b', source: descriptor.template.content, filename: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const page = readFileSync(resolve(root, 'aims/layer/pages/enterprise-project-requirements.vue'), 'utf8')
  assert.match(page, /syncBatch\(batch\)/)
  assert.match(page, /不能由浏览器写入/)
  assert.doesNotMatch(page, /onApproved|\/approve|\/reject/)
  assert.match(page, /batch\.status === 'pending' && !batch\.workflowInstanceId/)
  const task = readFileSync(resolve(root, 'aims/app/components/requirements/task/CreateTaskDialog.vue'), 'utf8')
  assert.match(task, /useRequirementIntent/)
  assert.match(task, /moduleUrl\(`\/api\/v1\/projects\/\$\{props.projectId\}\/requirements/)
})

test('R1b typed calls retain read scopes and fresh write authorization on every retry', async () => {
  const calls = []
  const state = { readAllowed: true, scopeAllowed: true, writeAllowed: true }
  globalThis.__r1b = { state, calls }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/owningModuleHttp')) source = 'export const owningCreateError=x=>Object.assign(new Error(x.message),x)'
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'host'});export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const prepareEnterpriseRuntime=async()=>{};export const callEnterpriseRuntime=async(...args)=>{globalThis.__r1b.calls.push(args);return {code:0,data:{}}}`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__r1b.state.readAllowed?{requirements:['view']}:{},actionPolicies:{}})`
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=(r,k,a)=>r[k]?.includes(a)===true'
    if (specifier.endsWith('/projectCommandAuthorization')) source = `export const loadProjectCommandAuthorization=async(_e,u,p)=>{if(!globalThis.__r1b.state.writeAllowed)throw Object.assign(new Error('denied'),{statusCode:403});return {actorUid:u.uid,tenant:u.tenant,deployment:u.deployment,...p,allowed:true}}`
    // These are import-only dependencies of the existing specification import.
    // R1b must never use a service API or repository source to mutate requirements.
    if (specifier.endsWith('/codocsApi')) source = 'export const getCodocsProjectDocumentContent=()=>{throw new Error("unexpected source request")}'
    if (specifier.endsWith('/projectDocumentPorts')) source = 'export const hostProjectDocumentContext=()=>{throw new Error("unexpected document context")}'
    if (specifier.endsWith('/projectDocumentSources')) source = 'export const readHostProjectDocumentSource=()=>{throw new Error("unexpected repository read")}'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let path
    if (specifier.startsWith('@hzy/foundation/')) path = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (path && !existsSync(path) && existsSync(path + '.ts')) return { url: pathToFileURL(path + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  const provider = async (projectId) => {
    if (!state.scopeAllowed) throw Object.assign(new Error('scope denied'), { statusCode: 403 })
    return { query: {}, authorization: { projectId, actorUid: 'actor', scope: { version: 1, masks: [65535] } } }
  }
  try {
    const { readHostProjectRequirements, writeHostProjectRequirement } = await import('../../aims/layer/server/internal/projectRequirements.ts')
    for (const action of reads) {
      const object = action === 'review-list' ? '' : '9'
      await readHostProjectRequirements({}, provider, action, '263', object)
      const call = calls.at(-1)
      assert.equal(call[1], 'aims.project-requirement-' + action)
      assert.equal(call[2].projectReadAuthorization.projectId, '263')
      assert.equal(call[2].authorization.actorUid, 'actor')
      assert.equal(call[2].authorization.resource, 'requirements')
      for (const flag of ['readAllowed', 'scopeAllowed']) {
        const count = calls.length
        state[flag] = false
        await assert.rejects(readHostProjectRequirements({}, provider, action, '263', object), e => e.statusCode === 403)
        assert.equal(calls.length, count)
        state[flag] = true
      }
    }
    for (const action of writes) {
      const object = action === 'review-create' ? '' : '9'
      const payload = action === 'review-create' ? { batchType: 'baseline', requirementIds: [9] } : action === 'review-append' ? { requirementIds: [9] } : {}
      for (let attempt = 0; attempt < 2; attempt++) {
        await writeHostProjectRequirement({}, provider, action, '263', object, payload, 'same-intent', {})
        const call = calls.at(-1)
        assert.equal(call[1], 'aims.project-requirement-' + action)
        assert.equal(call[2].authorization.projectId, '263')
        assert.equal(call[2].authorization.objectId, object)
        assert.equal(call[2].authorization.resource, 'requirements')
        assert.equal(call[2].authorization.action, 'edit')
        assert.equal(call[3].idempotencyKey, 'same-intent')
      }
      state.writeAllowed = false
      const count = calls.length
      await assert.rejects(writeHostProjectRequirement({}, provider, action, '263', object, payload, 'same-intent', {}), e => e.statusCode === 403)
      assert.equal(calls.length, count)
      state.writeAllowed = true
      await assert.rejects(writeHostProjectRequirement({}, provider, action, '263', object, { ...payload, approvedBy: 'forged' }, 'same-intent', {}), e => e.statusCode === 400)
      assert.equal(calls.length, count)
    }
  } finally {
    hooks.deregister()
    delete globalThis.__r1b
  }
})
