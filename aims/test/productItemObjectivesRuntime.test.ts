import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productModelInput'
import * as cross from '../server/utils/productCrossDependencyInput'
import * as workspace from '../server/utils/productWorkspaceInput'

const id = '00000000-0000-4000-8000-000000000001'
const draft = { expectedRevision: 2, definition: { title: '季度路线', audience: 'delivery', visibility: 'personal', cycleId: id, year: 2026, quarter: 4, unscheduled: false } }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productItemObjectivesRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { path?: string, method?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, admin?: boolean, mixed?: boolean, wrongProduct?: boolean, unavailable?: boolean, error?: boolean } = {}) {
 const calls: any[] = [], permissions: string[] = [], exports: any = {}
 const facts = { product_code: options.wrongProduct ? 'OTHER' : 'P-A', actor_uid: 'session-user', revision: 2, status: 'active', is_member: true, is_manager: true }
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? 'P-A' : options.path ?? 'create', getQuery: () => options.query ?? {}, getHeader: () => options.key === undefined ? 'model-key' : options.key, readBody: async () => options.body ?? draft, setHeader: () => {} }
  if (name === './productModelInput') return input
  if (name === './productCrossDependencyInput') return cross
  if (name === './productWorkspaceInput') return workspace
  if (name === './productAuthorization') return {
   requireProductPermission: async (_: unknown, _code: string, resource: string, action: string) => { permissions.push(resource + ':' + action); if (options.denied) throw createError({ statusCode: 403 }); return { ...facts, revision: options.mixed && resource === 'product_priorities' ? 3 : 2 } },
   checkProductPermission: async (_: unknown, _code: string, resource: string, action: string) => { permissions.push(resource + ':' + action); return { allowed: options.admin ?? false, facts: { ...facts, revision: options.mixed ? 3 : 2 } } }
  }
  if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => { calls.push({ path, args }); return { handled: !options.unavailable, data: { code: options.error ? 409 : 0, data: {} } } } }
  if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
  throw new Error(name)
 } })
 return { calls, permissions, run: () => exports.handleProductItemObjectives({ method: options.method ?? 'GET' }, options.path ?? id) }
}


test('item objectives bind identity, bounded pagination and both current permissions', async () => {
 const h = harness({ query: { page: '2', pageSize: '10' } }); await h.run()
 assert.deepEqual(h.permissions, ['product_objectives:view', 'product_priorities:view'])
 assert.equal(h.calls[0].path, '/v1/aims/internal/products/P-A/objectives:item-objectives')
 assert.equal(h.calls[0].args.scope, 'aims.read aims:product-objectives:read')
 assert.equal(h.calls[0].args.query.current_user, 'session-user')
 assert.equal(h.calls[0].args.body.input.item_biz_id, id)
 assert.equal(h.calls[0].args.body.input.page, 2)
 assert.equal(h.calls[0].args.body.input.page_size, 10)
 assert.equal(h.calls[0].args.body.planning_authorization.resource, 'product_priorities')
})
test('item objectives reject authority overrides and inconsistent facts before transport', async () => {
 for (const [options, statusCode] of [[{ method:'POST' },405], [{path:'invalid'},400], [{query:{pageSize:'101'}},400], [{query:{actor_uid:'override'}},400], [{denied:true},403], [{mixed:true},409], [{wrongProduct:true},409], [{unavailable:true},503], [{error:true},409]] as const) {
  const h = harness(options); await assert.rejects(h.run(), {statusCode})
  if (!('unavailable' in options) && !('error' in options)) assert.equal(h.calls.length,0)
 }
})
