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
const draft = { expectedRevision: 2, title: '价值模型', reason: '调整权重', version: 'v2', strategic: 10, userValue: 60, business: 20, risk: 10 }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productModelRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { path?: string, method?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, admin?: boolean, mixed?: boolean, wrongProduct?: boolean, unavailable?: boolean, error?: boolean } = {}) {
 const calls: any[] = [], permissions: string[] = [], exports: any = {}
 const facts = { product_code: options.wrongProduct ? 'OTHER' : 'P-A', actor_uid: 'session-user', revision: 2, status: 'active', is_member: true, is_manager: true }
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? 'P-A' : options.path ?? 'create', getQuery: () => options.query ?? {}, getHeader: () => options.key === undefined ? 'model-key' : options.key, readBody: async () => options.body ?? draft, setHeader: () => {} }
  if (name === './productModelInput') return input
  if (name === './productCrossDependencyInput') return cross
  if (name === './productWorkspaceInput') return workspace
  if (name === './productAuthorization') return {
   requireProductPermission: async (_: unknown, _code: string, resource: string, action: string) => { permissions.push(resource + ':' + action); if (options.denied) throw createError({ statusCode: 403 }); return facts },
   checkProductPermission: async () => ({ allowed: options.admin ?? false, facts: { ...facts, revision: options.mixed ? 3 : 2 } })
  }
  if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => { calls.push({ path, args }); return { handled: !options.unavailable, data: { code: options.error ? 409 : 0, data: {} } } } }
  if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
  throw new Error(name)
 } })
 return { calls, permissions, run: () => exports.handleProductModel({ method: options.method ?? 'POST' }) }
}
test('model creation uses admin, trusted actor, exact capability and idempotency key', async () => {
 const h = harness(); await h.run()
 assert.deepEqual(h.permissions, ['product_priorities:admin'])
 const { path, args } = h.calls[0]
 assert.ok(path.endsWith('/priority-models:create'))
 assert.equal(args.scope, 'aims.write aims:product-priorities:model-create')
 assert.equal(args.query.current_user, 'session-user')
 assert.equal(args.idempotencyKey, 'model-key')
 assert.equal(args.body.input.model.user_value, 60)
 assert.equal(args.body.authorization.action, 'admin')
 assert.ok(args.body.authorization.expires_at > Date.now())
})
test('model list forwards pagination with view capability and no write key', async () => {
 const h = harness({ path: 'list', method: 'GET', query: { page: '2', pageSize: '10' } }); await h.run()
 assert.deepEqual(h.permissions, ['product_priorities:view'])
 assert.equal(h.calls[0].args.scope, 'aims.read aims:product-priorities:read')
 assert.equal(h.calls[0].args.body.input.page, 2)
 assert.equal(h.calls[0].args.body.input.page_size, 10)
 assert.equal(h.calls[0].args.idempotencyKey, undefined)
})
test('cycle selection binds URL identity and both revisions', async () => {
 const h = harness({ path: 'cycles/' + id, body: { expectedRevision: 2, expectedCycleRevision: 3, modelVersion: 'v2', reason: '周期选用' } }); await h.run()
 assert.equal(h.calls[0].args.scope, 'aims.write aims:product-priorities:cycle-model-select')
 assert.equal(h.calls[0].args.body.input.biz_id, id)
 assert.equal(h.calls[0].args.body.input.expected_cycle_revision, 3)
})
test('invalid inputs, authorization changes and service failures never succeed', async () => {
 for (const [options, statusCode] of [
  [{ key: null }, 400], [{ query: { actor: 'other' } }, 400],
  [{ body: { ...draft, configuration: {} } }, 400], [{ path: 'cycles/bad' }, 404],
  [{ method: 'GET' }, 405], [{ denied: true }, 403], [{ wrongProduct: true }, 409],
  [{ path: 'list', method: 'GET', query: { pageSize: '101' } }, 400],
  [{ unavailable: true }, 503], [{ error: true }, 409]
 ] as const) {
  const h = harness(options); await assert.rejects(h.run(), { statusCode })
  if (!('unavailable' in options) && !('error' in options)) assert.equal(h.calls.length, 0)
 }
})
test('permission snapshot preserves admin denial and rejects inconsistent facts', async () => {
 const h = harness({ path: 'permissions', method: 'GET' })
 assert.equal((await h.run()).data.admin, false); assert.equal(h.calls.length, 0)
 assert.equal((await harness({ path: 'permissions', method: 'GET', admin: true }).run()).data.admin, true)
 for (const [options, statusCode] of [[{ mixed: true }, 409], [{ denied: true }, 403], [{ query: { actor: 'x' } }, 400], [{ method: 'POST' }, 405]] as const) await assert.rejects(harness({ path: 'permissions', method: 'GET', ...options }).run(), { statusCode })
})

test('RICE browser creation binds dedicated route and shared precise model capability', async () => {
 const body = { expectedRevision: 1, title: 'RICE', reason: '统一口径', version: 'rice-v1', reachUnit: 'unique_users', reachDefinition: '按 UID 去重', reachStartsOn: '2026-10-01', reachEndsOn: '2026-12-31', sourceDefinition: '事件统计' }
 const h = harness({ path: 'rice-create', body }); await h.run()
 assert.ok(h.calls[0].path.endsWith('/priority-models:rice-create'))
 assert.equal(h.calls[0].args.scope, 'aims.write aims:product-priorities:model-create')
 assert.equal(h.calls[0].args.body.input.model.reach_starts_on, '2026-10-01')
 assert.deepEqual(h.permissions, ['product_priorities:admin'])
 assert.equal(h.calls[0].args.idempotencyKey, 'model-key')
 await assert.rejects(harness({ path: 'rice-create', body: draft }).run(), { statusCode: 400 })
 await assert.rejects(harness({ path: 'create', body }).run(), { statusCode: 400 })
 await assert.rejects(harness({ path: 'rice-create', body, denied: true }).run(), { statusCode: 403 })
})
