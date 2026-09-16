import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import ts from 'typescript'

test('link proof follows scoped product lookup and document ACL and binds identities', async () => {
  const source = readFileSync(new URL('../server/utils/productDocumentLinkAuthorization.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('export async function', 'async function')
  const calls: string[] = []
  let deny = false
  const context = createContext({
    createError: (input: { statusCode: number }) => Object.assign(new Error('rejected'), input),
    extractServiceOperationStatus: () => 403,
    maybeCallTenantRuntime: async (_event: unknown, path: string, options: { query: Record<string, unknown> }) => {
      calls.push('product')
      assert.equal(path, '/v1/assets/products/7')
      assert.equal(options.query.current_user, 'u1')
      assert.equal(options.query.current_user_assets_object_access, 'relation')
      return { handled: true, data: { code: 0, data: { product_code: 'P1' } } }
    },
    readAssetProductDocumentMetadata: async (_event: unknown, product: string, document: string) => {
      calls.push('document')
      assert.equal(product, 'P1')
      assert.equal(document, '00000000-0000-4000-8000-000000000001')
      if (deny) throw new Error('document denied')
    }
  })
  new Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  const body = { document_id: '00000000-0000-4000-8000-000000000001' }
  const scope = { current_user_assets_object_access: 'relation', current_user: 'forged' }
  const before = Date.now()
  const result = await context.authorizeProductDocumentLink({}, '7', body, 'u1', scope)
  assert.deepEqual(calls, ['product', 'document'])
  assert.equal(result.current_user_product_document_actor, 'u1')
  assert.equal(result.current_user_product_document_id, '7')
  assert.equal(result.current_user_product_document_code, 'P1')
  assert.equal(result.current_user_product_document_uuid, body.document_id)
  assert.ok(Number(result.current_user_product_document_expires) >= before + 15000)
  deny = true
  await assert.rejects(context.authorizeProductDocumentLink({}, '7', body, 'u1', scope), /document denied/)
  calls.length = 0
  await assert.rejects(context.authorizeProductDocumentLink({}, '7', { ...body, documentUuid: 'different' }, 'u1', scope))
  assert.deepEqual(calls, [])
})
