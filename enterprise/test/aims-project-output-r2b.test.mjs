import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const text = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
test('R2b UI enables three actions with stable intent keys and no browser snapshot or role facts', () => {
  const page = text('aims/layer/pages/enterprise-project-output.vue')
  for (const value of ['送检', '完整性确认', '豁免', 'qualityIntents', '\'Idempotency-Key\'', 'qualitySaving', 'currentSubmissionId', 'currentReviewRoute', 'tone: \'warning\'']) assert.ok(page.includes(value), value)
  assert.doesNotMatch(page, /质量操作将在下一批恢复|current_user_is_qa|current_user_can_waive/)
  const { descriptor, errors } = parse(page)
  assert.deepEqual(errors, [])
  compileScript(descriptor, { id: 'r2b' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, id: 'r2b' }).errors, [])
  const routes = text('enterprise/composition/business-api-routes.generated.mjs')
  for (const suffix of ['deliverables/:deliverableId/submissions', 'deliverables/:deliverableId/waivers', 'deliverable-submissions/:submissionId/confirm-completeness']) assert.ok(routes.includes(`/aims/api/v1/projects/:id/${suffix}`))
})

test('R2b typed writes freeze server snapshots, grant before activate, reauthorize retries and reject forged bodies', async () => {
  const state = { calls: [], grants: [], files: [], allow: true, qa: 'actor', failGrant: false, resume: null, nextVersion: 12, resolved: [] }
  globalThis.__r2b = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/owningModuleHttp')) source = 'export const owningCreateError=x=>Object.assign(new Error(x.message),x)'
    if (specifier.endsWith('/projectCommandAuthorization')) source = `export const loadProjectCommandAuthorization=async(e,u,t)=>{if(!globalThis.__r2b.allow)throw Object.assign(new Error('denied'),{statusCode:403});return {...t,allowed:true,actorUid:u.uid,expiresAt:Date.now()+14000}}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'actor',tenant:'T',deployment:'host'});export const prepareEnterpriseRuntime=async()=>{};export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+14000;export const callEnterpriseRuntime=async(e,op,body,opt)=>{const s=globalThis.__r2b;s.calls.push({op,body,opt});if(op==='aims.project-deliverable-list')return {code:0,data:[{id:8,projectId:263,projectCode:'P263',deliverableType:'document',documentSource:'codocs',documentUuid:'uuid'}]};if(op==='aims.quality-submission-resume')return {code:0,data:{submission:s.resume}};if(op==='aims.quality-submission-create'){s.resume={id:9,contentSha256:'a'.repeat(64),submittedBy:'actor',documentSource:'codocs',documentUuid:'uuid',documentVersionId:12,submissionNo:'DLV-8-DOC-12',reviewRoute:'qa'};return {code:0,data:{id:9,submittedBy:'actor',documentSource:'codocs',documentUuid:'uuid',documentVersionId:12,submissionNo:'DLV-8-DOC-12',reviewRoute:'qa'}}};return {code:0,data:{id:9}}}`
    if (specifier.endsWith('/projectGovernanceRoleHolder')) source = `export const resolveProjectGovernanceRoleHolder=async()=>({uid:globalThis.__r2b.qa,revision:27});export const requireCurrentProjectGovernanceRoleHolder=async()=>{if(globalThis.__r2b.qa!=='actor')throw Object.assign(new Error('not holder'),{statusCode:403});return {uid:'actor',revision:27}}`
    if (specifier.endsWith('/codocsApi')) source = `export const resolveCodocsProjectDocumentVersion=async p=>{const s=globalThis.__r2b;s.resolved.push(p);return {documentUuid:'uuid',versionId:p.versionId==='latest'?s.nextVersion:Number(p.versionId),versionNum:3,contentSha256:'a'.repeat(64)}};export const createCodocsProjectDocumentReviewGrant=async p=>{globalThis.__r2b.grants.push(p);if(globalThis.__r2b.failGrant)throw Object.assign(new Error('unavailable'),{statusCode:503});return {...p,grantId:41}}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { writeHostDeliverableQuality: write } = await import('../../aims/layer/server/internal/deliverableQuality.ts')
    for (const body of [{ current_user_is_qa: true }, { contentSha256: 'forged' }, { documentVersionId: 12 }, { reviewGrantId: 41 }]) await assert.rejects(() => write({}, 'submission', '263', '8', body, 'intent', {}), { statusCode: 400 })
    assert.equal(state.calls.length, 0)
    state.allow = false
    await assert.rejects(() => write({}, 'submission', '263', '8', {}, 'intent', {}), { statusCode: 403 })
    assert.equal(state.grants.length, 0)
    state.allow = true
    state.failGrant = true
    await assert.rejects(() => write({}, 'submission', '263', '8', {}, 'intent', {}), { statusCode: 503 })
    assert.equal(state.calls.filter(x => x.op === 'aims.quality-submission-activate').length, 0)
    state.failGrant = false
    state.nextVersion = 13
    await write({}, 'submission', '263', '8', {}, 'intent', {})
    assert.equal(state.resolved.at(-1).versionId, 12)
    const creates = state.calls.filter(x => x.op === 'aims.quality-submission-create')
    assert.equal(creates.length, 2)
    assert.equal(creates[0].opt.idempotencyKey, creates[1].opt.idempotencyKey)
    assert.deepEqual(creates[0].body.input, creates[1].body.input)
    assert.equal(creates[1].body.input.contentSha256, 'a'.repeat(64))
    assert.equal(creates[1].body.facts.qaRevision, 27)
    const activation = state.calls.at(-1)
    assert.equal(activation.op, 'aims.quality-submission-activate')
    assert.equal(activation.body.objectId, '9')
    assert.equal(activation.body.input.reviewGrantId, 41)
    state.qa = 'other'
    const before = state.calls.length
    await assert.rejects(() => write({}, 'waiver', '263', '8', { reason: 'test' }, 'waive', {}), { statusCode: 403 })
    assert.equal(state.calls.length, before)
    await assert.rejects(() => write({}, 'completeness', '263', '9', { action: 'return', comment: '' }, 'return', {}), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__r2b
  }
})
