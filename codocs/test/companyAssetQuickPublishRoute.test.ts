import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../server/api/company-assets/import-documents.post.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
function harness(denied = '', completed = false) {
  const calls: string[] = []
  const input = { subdir: 'rules', targetPath: '', documentUuids: ['document'], operationId: 'op', current_user: 'forged', sourcePath: 'codocs/private/secret' }
  const dependencies: Record<string, unknown> = {
    'node:crypto': { randomUUID: () => 'random' },
    '~~/server/utils/checkPermission': { requirePermission: async (_event: unknown, resource: string, action: string) => {
      calls.push(`${resource}:${action}`)
      if (resource === denied) throw Object.assign(new Error('forbidden'), { statusCode: 403 })
    } },
    '~~/server/utils/authIdentity': { requireRequestUid: () => 'admin' },
    '~~/server/utils/assetOssPath': { buildCompanyAssetPrefix: () => 'codocs/company/rules/' },
    '~~/server/utils/codocsRuntime': { callCodocsTenantRuntime: async (_event: unknown, path: string, options: { query: Record<string, unknown>, body: Record<string, unknown> }) => {
      calls.push(path)
      assert.equal(options.query.current_user, 'admin')
      assert.equal(options.query.codocs_trusted_company_quick_publish, '1')
      assert.equal(options.body.sourcePath, undefined)
      assert.equal(options.body.current_user, undefined)
      if (path.endsWith('/prepare')) return { completed, plan: { items: [{ sourceUuid: 'source' }] }, result: { imported: [] } }
      return { imported: ['published'] }
    } },
    '~~/server/utils/oss': { createRuntimeOSSClient: async () => {
      calls.push('storage')
      return {}
    } },
    '~~/server/utils/companyAssetQuickPublish': { copyQuickPublishDocument: async () => {
      calls.push('copy')
      return {}
    } }
  }
  const exports: { default?: (event: unknown) => Promise<unknown> } = {}
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      assert.ok(dependencies[id], `unapproved dependency (including notifications): ${id}`)
      return dependencies[id]
    },
    defineEventHandler: (fn: unknown) => fn,
    readBody: async () => {
      calls.push('body')
      return input
    },
    createError: (value: object) => Object.assign(new Error(), value)
  })
  return { calls, run: () => exports.default!({}) }
}
test('ordinary users and administrators lacking publish permission are denied before body or storage', async () => {
  for (const denied of ['admin', 'company']) {
    const h = harness(denied)
    await assert.rejects(h.run(), { statusCode: 403 })
    assert.equal(h.calls.includes('body'), false)
    assert.equal(h.calls.includes('storage'), false)
  }
})
test('quick publish uses only authorized runtime plans and sends no notification or approval', async () => {
  const h = harness()
  await h.run()
  assert.deepEqual(h.calls, ['admin:admin', 'company:publish', 'body', '/v1/codocs/company-assets/quick-publish/prepare', 'storage', 'copy', '/v1/codocs/company-assets/quick-publish/complete'])
})
test('completed retry returns its result without storage work', async () => {
  const h = harness('', true)
  await h.run()
  assert.equal(h.calls.includes('storage'), false)
})
