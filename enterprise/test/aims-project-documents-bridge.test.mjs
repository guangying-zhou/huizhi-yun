import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Execute the owning core without a TCP listener: this also fixes the assertion
// that formerly required the Host to use an independently authenticated Aims hop.
test('owning project document read uses fixed U operations with verified user and scoped parent permit', async () => {
  const root = resolve(import.meta.dirname, '../..'), calls = []
  const session = { uid: 'person-a', tenant: 'tenant-a', deployment: 'deployment-a' }
  globalThis.__documentReadSession = session
  globalThis.__documentReadAllowed = true
  globalThis.__documentReadCall = async (...args) => {
    calls.push(args)
    return { code: 0, data: {} }
  }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = 'export const requireEnterpriseUser=async()=>globalThis.__documentReadSession; export const prepareEnterpriseRuntime=async()=>{}; export const enterpriseRuntimePermitExpiresAt=()=>123; export const callEnterpriseRuntime=(...args)=>globalThis.__documentReadCall(...args)'
    if (specifier.endsWith('/platformBundleAuthorization')) source = 'export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:globalThis.__documentReadAllowed?{projects:[\'view\']}:{},actionPolicies:{}})'
    if (specifier.endsWith('/authorizationActions')) source = 'export const authorizationResourcesAllow=(resources,resource,action)=>resources?.[resource]?.includes(action)===true'
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    let candidate
    if (specifier.startsWith('@hzy/foundation/')) candidate = resolve(root, 'foundation', specifier.slice('@hzy/foundation/'.length))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { readHostProjectDocuments } = await import('../../aims/layer/server/internal/projectDocuments.ts')
    const permit = { projectId: '12', actorUid: 'person-a', scope: { version: 1, masks: [65535] }, bundleVersion: 'v27', bundleHash: 'hash', policyRevision: 27 }
    const event = {}
    await readHostProjectDocuments(event, { projectId: '12', projectReadAuthorization: permit, query: { docCategory: 'design' } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1], 'aims.project-document-list')
    const body = calls[0][2]
    assert.deepEqual(body.authorization, { actorUid: session.uid, tenant: session.tenant, deployment: session.deployment, resource: 'projects', action: 'view', expiresAt: 123 })
    assert.equal(body.projectReadAuthorization, permit)
    assert.equal(body.projectId, '12')
    assert.deepEqual(body.query, { docCategory: 'design' })
    await readHostProjectDocuments(event, { projectId: '12', documentId: '9', projectReadAuthorization: permit })
    assert.equal(calls[1][1], 'aims.project-document-view')
    assert.equal(calls[1][2].documentId, '9')
    const before = calls.length
    for (const input of [{ projectId: '0' }, { projectId: '12', documentId: '../9' }, { projectId: '12', query: { tenant: 'other' } }, { projectId: '12', documentId: '9', query: { docCategory: 'design' } }]) {
      await assert.rejects(readHostProjectDocuments(event, { ...input, projectReadAuthorization: permit }), e => e.statusCode === 400)
    }
    globalThis.__documentReadAllowed = false
    await assert.rejects(readHostProjectDocuments(event, { projectId: '12', projectReadAuthorization: permit }), e => e.statusCode === 403)
    assert.equal(calls.length, before)
  } finally {
    hooks.deregister()
    delete globalThis.__documentReadSession
    delete globalThis.__documentReadAllowed
    delete globalThis.__documentReadCall
  }
})

test('Host list/view has no Aims HTTP hop; open retains native Codocs ACL read/recheck', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../server/utils/enterpriseAimsProjectDocuments.ts'), 'utf8')
  assert.match(source, /aims\/layer\/server\/index/)
  assert.match(source, /readHostProjectDocuments/)
  assert.doesNotMatch(source, /serviceAppFetch|requestWithServiceAccessToken|maybeCallTenantRuntime|consoleAuth/)
  assert.match(source, /openEnterpriseProjectDocument\(event, \(\) => read\(event, true\)\)/)
})
