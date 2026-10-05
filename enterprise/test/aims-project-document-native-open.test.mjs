import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

test('Host native open preserves project relationship and independent Codocs ACL before releasing content', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === './enterpriseCodocsDocumentReads') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export const enterpriseCodocsDocumentViewByUuid=(...args)=>globalThis.__nativeProjectDocumentRead(...args)')}` }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
      if (!existsSync(candidate) && existsSync(candidate + '.ts')) return { shortCircuit: true, url: pathToFileURL(candidate + '.ts').href }
    }
    return next(specifier, context)
  } })
  try {
    const { openEnterpriseProjectDocument } = await import('../server/utils/enterpriseAimsProjectDocumentOpen.ts')
    const event = { context: { params: { documentId: '44' } } }
    const uuid = '11111111-1111-4111-8111-111111111111'
    const otherUuid = '22222222-2222-4222-8222-222222222222'
    const project = () => ({ code: 0, data: { id: 44, documentSource: 'codocs', codocsUuid: uuid } })
    const document = () => ({ success: true, data: { uuid, title: 'fixture', doc_type: 'project', oss_path: 'private-fixture-key', updated_at: '2026-09-26', content: 'fixture content' } })
    const calls = []
    globalThis.__nativeProjectDocumentRead = async (_event, code, metadataOnly) => {
      calls.push(['codocs', code, metadataOnly === true])
      return document()
    }
    const result = await openEnterpriseProjectDocument(event, async () => {
      calls.push(['aims'])
      return project()
    })
    assert.equal(result.data.content.content, 'fixture content')
    assert.equal(result.data.content.oss_path, undefined)
    assert.deepEqual(calls, [['aims'], ['codocs', uuid, false], ['aims'], ['codocs', uuid, true]])

    // Non-member/out-of-scope and an unrelated document must not reach Codocs.
    for (const statusCode of [403, 404]) {
      calls.length = 0
      await assert.rejects(openEnterpriseProjectDocument(event, async () => {
        throw Object.assign(new Error('fixture project refusal'), { statusCode })
      }), { statusCode })
      assert.equal(calls.length, 0)
    }
    for (const data of [{ ...project().data, id: 45 }, { ...project().data, codocsUuid: '../../other' }, { ...project().data, documentSource: 'repo' }]) {
      calls.length = 0
      await assert.rejects(openEnterpriseProjectDocument(event, async () => ({ code: 0, data })))
      assert.equal(calls.length, 0)
    }
    for (const statusCode of [403, 404, 503]) {
      globalThis.__nativeProjectDocumentRead = async () => {
        throw Object.assign(new Error('fixture Codocs refusal'), { statusCode })
      }
      await assert.rejects(openEnterpriseProjectDocument(event, async () => project()), { statusCode })
    }

    globalThis.__nativeProjectDocumentRead = async () => document()
    let projectReads = 0
    await assert.rejects(openEnterpriseProjectDocument(event, async () => ({ code: 0, data: { ...project().data, codocsUuid: ++projectReads === 1 ? uuid : otherUuid } })), { statusCode: 409 })
    for (const key of ['oss_path', 'updated_at']) {
      let reads = 0
      globalThis.__nativeProjectDocumentRead = async () => ({ success: true, data: { ...document().data, [key]: ++reads === 1 ? document().data[key] : 'changed' } })
      await assert.rejects(openEnterpriseProjectDocument(event, async () => project()), { statusCode: 409 })
    }
    let reads = 0
    globalThis.__nativeProjectDocumentRead = async () => {
      if (++reads === 2) throw Object.assign(new Error('fixture revoked ACL'), { statusCode: 403 })
      return document()
    }
    await assert.rejects(openEnterpriseProjectDocument(event, async () => project()), { statusCode: 403 })
  } finally {
    hooks.deregister()
    delete globalThis.__nativeProjectDocumentRead
  }
})
