import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Enterprise version view reads the exact OSS version and rejects mismatched bytes', async () => {
  const original = {
    runtime: globalThis.__versionIntegrityRuntime,
    object: globalThis.__versionIntegrityObject,
    requested: globalThis.__versionIntegrityRequested,
    rows: globalThis.__versionIntegrityRows
  }
  const body = Buffer.from('# version one\n')
  const row = {
    id: 7, version_num: 1, oss_version_id: 'oss-version-7', editor_uid: 'person-a',
    content_size: body.length, content_sha256: createHash('sha256').update(body).digest('hex'),
    created_at: '2026-09-22T00:00:00Z'
  }
  globalThis.__versionIntegrityRuntime = async (_event, operation, request) => {
    if (operation === 'codocs.personal-document-version-view') {
      assert.equal(request.objectId, '7')
      assert.equal(request.authorization.action, 'read')
      return { success: true, data: row }
    }
    if (operation === 'codocs.personal-document-versions-list') {
      assert.equal(request.authorization.action, 'read')
      return { success: true, data: { items: globalThis.__versionIntegrityRows } }
    }
    if (operation === 'codocs.personal-document-view') {
      assert.deepEqual(request.query, {}, 'Runtime view accepts no Host-only flags')
      return { success: true, data: { uuid: 'doc-1', oss_path: 'codocs/users/person-a/doc-1.md', doc_type: 'markdown' } }
    }
    throw new Error(`unexpected operation: ${operation}`)
  }
  globalThis.__versionIntegrityObject = body
  globalThis.__versionIntegrityRequested = []
  const hooks = registerHooks({
    resolve(specifier, _context, next) {
      let source
      if (specifier === '@hzy/foundation/server/utils/enterpriseRuntimeClient') source = `
        export const requireEnterpriseUser=async()=>({uid:'person-a',tenant:'tenant-a',deployment:'enterprise-test'});
        export const prepareEnterpriseRuntime=async()=>true;
        export const enterpriseRuntimePermitExpiresAt=()=>Date.now()+15000;
        export const callEnterpriseRuntime=(...args)=>globalThis.__versionIntegrityRuntime(...args)`
      if (specifier === '@hzy/foundation/server/utils/platformBundleAuthorization') source = `
        export const loadAuthorizationSnapshotFromConsoleRuntime=async()=>({resources:{documents:['view']},actionPolicies:{}})`
      if (specifier === '@hzy/foundation/shared/utils/authorizationActions') source = `
        export const authorizationResourcesAllow=()=>true`
      if (specifier.endsWith('/codocs/server/utils/oss')) source = `
        export const createRuntimeOSSClient=async()=>({get:async(path,options)=>{
          globalThis.__versionIntegrityRequested.push({path,options});
          if (globalThis.__versionIntegrityObject==='MISSING') throw Object.assign(new Error('missing'),{statusCode:404,code:'NoSuchKey'});
          if (globalThis.__versionIntegrityObject==='DOWN') throw Object.assign(new Error('down'),{statusCode:500});
          return {content:globalThis.__versionIntegrityObject}
        }})`
      if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      return next(specifier)
    }
  })
  let server
  try {
    const { enterpriseCodocsVersionView } = await import('../server/utils/enterpriseCodocsVersions.ts')
    const app = createApp()
    const router = createRouter()
    router.get('/documents/:uuid/versions/:versionId', defineEventHandler(enterpriseCodocsVersionView))
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/documents/doc-1/versions/7`

    const valid = await fetch(url)
    assert.equal(valid.status, 200)
    assert.equal((await valid.json()).data.content, body.toString('utf-8'))
    assert.deepEqual(globalThis.__versionIntegrityRequested.at(-1), {
      path: 'codocs/users/person-a/doc-1.md', options: { versionId: 'oss-version-7' }
    })

    globalThis.__versionIntegrityObject = Buffer.from('# wrong bytes\n')
    assert.equal((await fetch(url)).status, 503)

    globalThis.__versionIntegrityObject = body
    row.content_size = body.length + 1
    assert.equal((await fetch(url)).status, 503)
    row.content_size = body.length

    row.content_sha256 = 'invalid-digest'
    assert.equal((await fetch(url)).status, 503)

    // Older rows without a digest remain readable through the exact OSS version.
    row.content_sha256 = null
    assert.equal((await fetch(url)).status, 200)

    // Superseded versions expire 30 days after replacement (accepted OSS
    // lifecycle): a missing superseded version is 410 with a stable code...
    globalThis.__versionIntegrityObject = 'MISSING'
    globalThis.__versionIntegrityRows = [row, { ...row, id: 8, version_num: 2 }]
    const expired = await fetch(url)
    assert.equal(expired.status, 410)
    const expiredBody = await expired.json()
    assert.equal(expiredBody.data.code, 'codocs_version_expired')
    assert.match(expiredBody.data.message, /30 天/)
    // ...but a missing current version stays a real 404, and outages stay 503.
    globalThis.__versionIntegrityRows = [row]
    assert.equal((await fetch(url)).status, 404)
    globalThis.__versionIntegrityObject = 'DOWN'
    assert.equal((await fetch(url)).status, 503)

    // A v2 history row is read from its own snapshot object at its version,
    // never from the derived oss_path, and it never reports "expired".
    globalThis.__versionIntegrityObject = body
    row.content_sha256 = createHash('sha256').update(body).digest('hex')
    row.object_key = 'codocs/snapshots/h/doc-1/k/a/body.md'
    assert.equal((await fetch(url)).status, 200)
    assert.deepEqual(globalThis.__versionIntegrityRequested.at(-1), {
      path: 'codocs/snapshots/h/doc-1/k/a/body.md', options: { versionId: 'oss-version-7' }
    })
    globalThis.__versionIntegrityObject = 'MISSING'
    globalThis.__versionIntegrityRows = [row, { ...row, id: 8, version_num: 2 }]
    assert.equal((await fetch(url)).status, 404)
    row.object_key = 'codocs/users/person-a/elsewhere.md'
    assert.equal((await fetch(url)).status, 503, 'object keys outside the snapshot namespace are rejected')
    row.object_key = null
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    hooks.deregister()
    globalThis.__versionIntegrityRuntime = original.runtime
    globalThis.__versionIntegrityObject = original.object
    globalThis.__versionIntegrityRequested = original.requested
    globalThis.__versionIntegrityRows = original.rows
  }
})
