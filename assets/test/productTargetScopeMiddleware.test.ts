import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import ts from 'typescript'
import { resolveAssetsApiPermission } from '../server/utils/assetsPermissionRoutes.ts'
import { sanitizeAssetsObjectAccessRecord } from '../server/utils/assetsScopedAuthorizationCore.ts'

test('product link derives target view independently and removes forged scope fields', async () => {
  const source = readFileSync(new URL('../server/middleware/tenant-runtime.ts', import.meta.url), 'utf8')
  const start = source.indexOf('async function resolveAssetsRuntimeQuery(')
  const end = source.indexOf('function shouldForwardAssetsRuntime(', start)
  assert.ok(start > 0 && end > start)
  const calls: string[] = []
  let unavailable = false
  const context = createContext({
    resolveAssetsApiPermission, sanitizeAssetsObjectAccessRecord,
    authorizeProductDocumentLink: async (_event: unknown, id: string, body: Record<string, unknown>, uid: string, scope: Record<string, unknown>) => {
      calls.push('document-proof')
      assert.equal(id, '7')
      assert.equal(uid, 'verified-user')
      assert.equal(scope.current_user_assets_object_access, 'relation')
      assert.equal(Object.keys(body).some(key => key.startsWith('current_user_product_document_')), false)
      assert.equal(Object.keys(scope).some(key => key.startsWith('current_user_product_document_')), false)
      return { current_user_product_document_actor: uid, current_user_product_document_uuid: body.document_id }
    },
    runtimeStatusFromContext: () => '', runtimeActionTypeFromContext: () => '', runtimeTargetTypeFromContext: () => '',
    resolveAssetsObjectScopeQuery: async (_event: unknown, uid: string, resource: string, action: string) => {
      assert.equal(uid, 'verified-user')
      calls.push(`${resource}:${action}`)
      if (resource === 'asset_items' || resource === 'technology_bases') {
        if (unavailable) throw new Error('authorization unavailable')
        return { current_user_assets_object_access: 'none' }
      }
      return { current_user_assets_object_access: 'relation', current_user_assets_scope_units: '[{"projectCodes":["P1"]}]' }
    }
  })
  new Script(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  const forged = { current_user_assets_object_access: 'all', current_user_assets_scope_units: '[]', current_user_assets_permission_action: 'admin', current_user_product_target_access: 'all', current_user_product_target_units: '[]' }
  const request = { event: {}, suffix: '/products/7/assets', method: 'POST', currentUser: 'verified-user', body: { ...forged, asset_id: 9 } }
  const result = await context.resolveAssetsRuntimeQuery(request, { ...forged, keyword: 'kept' })
  assert.deepEqual(calls, ['products:edit', 'asset_items:view'])
  assert.equal(result.current_user_assets_object_access, 'relation')
  assert.equal(result.current_user_assets_permission_action, 'edit')
  assert.equal(result.current_user_product_target_access, 'none')
  assert.equal(result.current_user_product_target_units, '[]')
  assert.equal(result.keyword, 'kept')
  assert.deepEqual(request.body, { asset_id: 9 })
  calls.length = 0
  const baseResult = await context.resolveAssetsRuntimeQuery({ ...request, suffix: '/products/7/bases' }, forged)
  assert.deepEqual(calls, ['products:edit', 'technology_bases:view'])
  assert.equal(baseResult.current_user_product_target_access, 'none')
  calls.length = 0
  const documentBody = { document_id: 'doc', current_user_product_document_actor: 'forged', current_user_product_document_expires: '9999999999999' }
  const documentResult = await context.resolveAssetsRuntimeQuery({ ...request, suffix: '/products/7/documents', body: documentBody }, { ...forged, current_user_product_document_uuid: 'forged' })
  assert.deepEqual(calls, ['products:edit', 'document-proof'])
  assert.equal(documentResult.current_user_product_document_actor, 'verified-user')
  assert.equal(documentResult.current_user_product_document_uuid, 'doc')
  assert.equal(documentResult.current_user_product_document_expires, undefined)
  unavailable = true
  await assert.rejects(context.resolveAssetsRuntimeQuery(request, forged), /authorization unavailable/)
  const anonymous = await context.resolveAssetsRuntimeQuery({ ...request, currentUser: '' }, forged)
  assert.equal(Object.keys(anonymous).length, 0)
})
