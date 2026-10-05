import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productReleaseDiffInput'
import * as product from '../server/utils/productCrossDependencyInput'

const query = { beforeVersionId: '1', beforeRecordId: '2', afterVersionId: '3', afterRecordId: '4', page: '2', pageSize: '10' }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productReleaseDiffRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { method?: string, query?: Record<string, unknown>, denied?: boolean, wrongProduct?: boolean, unavailable?: boolean, failure?: boolean } = {}) {
  const calls: { path: string, args: any }[] = [], permissions: string[] = [], headers: string[][] = []
  const exports: { handleProductReleaseDiff?: (event: object) => Promise<unknown> } = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: () => 'P-A', getQuery: () => options.query ?? query, setHeader: (_: unknown, key: string, value: string) => headers.push([key, value]) }
    if (name === './productReleaseDiffInput') return input
    if (name === './productCrossDependencyInput') return product
    if (name === './productAuthorization') return { requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
      permissions.push(`${code}:${resource}:${action}`)
      if (options.denied) throw createError({ statusCode: 403 })
      return { product_code: options.wrongProduct ? 'OTHER' : code, actor_uid: 'trusted-user', revision: 7 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => {
      calls.push({ path, args })
      return { handled: !options.unavailable, data: { code: options.failure ? 409 : 0, data: { total: 1 } } }
    } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    throw new Error(name)
  } })
  return { calls, permissions, headers, run: () => exports.handleProductReleaseDiff!({ method: options.method ?? 'GET' }) }
}
test('release diff forwards both record identities under trusted version authorization', async () => {
  const h = harness()
  await h.run()
  assert.deepEqual(h.permissions, ['P-A:product_versions:view'])
  assert.deepEqual(h.headers, [['Cache-Control', 'no-store']])
  const call = h.calls[0]!
  assert.equal(call.path, '/v1/aims/internal/products/P-A/versions:release-diff')
  assert.equal(call.args.scope, 'aims.read aims:product-versions:read')
  assert.equal(call.args.query.current_user, 'trusted-user')
  assert.equal(call.args.body.authorization.resource, 'product_versions')
  assert.equal(call.args.body.authorization.action, 'view')
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.body.input)), { before_version_id: 1, before_record_id: 2, after_version_id: 3, after_record_id: 4, page: 2, page_size: 10 })
})
test('release diff rejects overrides and permissions before transport and preserves service errors', async () => {
  for (const [options, statusCode] of [[{ method: 'POST' }, 405], [{ query: { ...query, actor: 'override' } }, 400], [{ denied: true }, 403], [{ wrongProduct: true }, 409], [{ unavailable: true }, 503], [{ failure: true }, 409]] as const) {
    const h = harness(options)
    await assert.rejects(h.run(), { statusCode })
    if (!('unavailable' in options) && !('failure' in options)) assert.equal(h.calls.length, 0)
  }
})
