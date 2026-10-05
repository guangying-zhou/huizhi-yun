import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productReachInput'
import * as cross from '../server/utils/productCrossDependencyInput'
import * as workspace from '../server/utils/productWorkspaceInput'

const id = '00000000-0000-4000-8000-000000000001'
const draft = { expectedRevision: 2, expectedItemRevision: 1, expectedScopeRevision: 1, expectedEvidenceRevision: 1, modelVersion: 'rice-v1', reach: 450, sourceReference: 'report-q4', methodology: '按 UID 去重' }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productReachRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { path?: string, method?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, admin?: boolean, mixed?: boolean, wrongProduct?: boolean, unavailable?: boolean, error?: boolean } = {}) {
 const calls: any[] = [], permissions: string[] = [], exports: any = {}
 const facts = { product_code: options.wrongProduct ? 'OTHER' : 'P-A', actor_uid: 'session-user', revision: 2, status: 'active', is_member: true, is_manager: true }
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? 'P-A' : options.path ?? 'items/' + id, getQuery: () => options.query ?? {}, getHeader: () => options.key === undefined ? 'model-key' : options.key, readBody: async () => options.body ?? draft, setHeader: () => {} }
  if (name === './productReachInput') return input
  if (name === './productCrossDependencyInput') return cross
  if (name === './productWorkspaceInput') return workspace
  if (name === './productAuthorization') return {
   requireProductPermission: async (_: unknown, _code: string, resource: string, action: string) => { permissions.push(resource + ':' + action); if (options.denied) throw createError({ statusCode: 403 }); return facts },
   checkProductPermission: async (_: unknown, _code: string, resource: string, action: string) => { permissions.push(resource + ':' + action); return { allowed: options.admin ?? false, facts: { ...facts, revision: options.mixed ? 3 : 2 } } }
  }
  if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => { calls.push({ path, args }); return { handled: !options.unavailable, data: { code: options.error ? 409 : 0, data: {} } } } }
  if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
  throw new Error(name)
 } })
 return { calls, permissions, run: () => exports.handleProductReach({ method: options.method ?? 'POST' }) }
}

test('Reach write binds item route, trusted actor, assess permission and exact write capability', async () => {
 const h = harness(); await h.run()
 assert.deepEqual(h.permissions, ['product_priorities:assess'])
 assert.ok(h.calls[0].path.endsWith('/reach-observations:record'))
 assert.equal(h.calls[0].args.body.input.item_biz_id, id)
 assert.equal(h.calls[0].args.body.input.reach, 450)
 assert.equal(h.calls[0].args.scope, 'aims.write aims:product-priorities:reach-record')
 assert.equal(h.calls[0].args.query.current_user, 'session-user')
 assert.equal(h.calls[0].args.idempotencyKey, 'model-key')
})
test('Reach list and detail are read-only, paginated and bound to observed route', async () => {
 const list = harness({ method: 'GET', query: { page: '2', pageSize: '10' } }); await list.run()
 assert.deepEqual(list.permissions, ['product_priorities:view'])
 assert.equal(list.calls[0].args.body.input.page, 2)
 assert.equal(list.calls[0].args.idempotencyKey, undefined)
 const detail = harness({ method: 'GET', path: 'items/' + id + '/' + id }); await detail.run()
 assert.ok(detail.calls[0].path.endsWith('/reach-observations:view'))
 assert.equal(detail.calls[0].args.body.input.biz_id, id)
 assert.equal(detail.calls[0].args.scope, 'aims.read aims:product-priorities:read')
})
test('Reach rejects forged inputs and fails closed on permission or Runtime failure', async () => {
 for (const [options, statusCode] of [[{ key: null }, 400], [{ body: { ...draft, recordedBy: 'other' } }, 400], [{ query: { actor: 'other' } }, 400], [{ path: 'items/bad' }, 404], [{ method: 'DELETE' }, 405], [{ path: 'items/' + id + '/' + id }, 405], [{ denied: true }, 403], [{ wrongProduct: true }, 409], [{ unavailable: true }, 503], [{ error: true }, 409]] as const) {
 const h = harness(options); await assert.rejects(h.run(), { statusCode })
 if (!('unavailable' in options) && !('error' in options)) assert.equal(h.calls.length, 0)
 }
})

test('Reach permission snapshot keeps explicit assess denial and rejects mixed authorization facts', async () => {
 const h = harness({ path: 'permissions', method: 'GET' })
 assert.equal((await h.run()).data.assess, false)
 assert.deepEqual(h.permissions, ['product_priorities:view', 'product_priorities:assess'])
 assert.equal(h.calls.length, 0)
 assert.equal((await harness({ path: 'permissions', method: 'GET', admin: true }).run()).data.assess, true)
 for (const [options, statusCode] of [[{ mixed: true }, 409], [{ denied: true }, 403], [{ query: { actor: 'other' } }, 400], [{ method: 'POST' }, 405]] as const) await assert.rejects(harness({ path: 'permissions', method: 'GET', ...options }).run(), { statusCode })
})
