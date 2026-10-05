import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productSavedViewInput'
import * as cross from '../server/utils/productCrossDependencyInput'
import * as workspace from '../server/utils/productWorkspaceInput'

const id = '00000000-0000-4000-8000-000000000001'
const draft = { expectedRevision: 2, definition: { title: '季度路线', audience: 'delivery', visibility: 'personal', cycleId: id, year: 2026, quarter: 4, unscheduled: false } }
const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productSavedViewRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { path?: string, method?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, admin?: boolean, mixed?: boolean, wrongProduct?: boolean, unavailable?: boolean, error?: boolean } = {}) {
 const calls: any[] = [], permissions: string[] = [], exports: any = {}
 const facts = { product_code: options.wrongProduct ? 'OTHER' : 'P-A', actor_uid: 'session-user', revision: 2, status: 'active', is_member: true, is_manager: true }
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? 'P-A' : options.path ?? 'create', getQuery: () => options.query ?? {}, getHeader: () => options.key === undefined ? 'model-key' : options.key, readBody: async () => options.body ?? draft, setHeader: () => {} }
  if (name === './productSavedViewInput') return input
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
 return { calls, permissions, run: () => exports.handleProductSavedView({ method: options.method ?? 'POST' }) }
}

test('saved view BFF binds both permissions and exact create capability', async () => {
 const h = harness(); await h.run()
 assert.deepEqual(h.permissions, ['product_priorities:view', 'product_roadmaps:view', 'product_roadmaps:edit'])
 assert.equal(h.calls[0].args.scope, 'aims.write aims:product-roadmaps:view-create')
 assert.equal(h.calls[0].args.query.current_user, 'session-user')
 assert.equal(h.calls[0].args.body.authorization.action, 'view')
 assert.equal(h.calls[0].args.body.input.definition.cycle_biz_id, id)
})
test('saved view read and apply retain query bounds and shared create requires edit', async () => {
 const h = harness({ path: id + '/apply', method: 'GET', query: { page: '2', pageSize: '10' } }); await h.run()
 assert.equal(h.calls[0].args.body.input.biz_id, id)
 assert.equal(h.calls[0].args.body.input.page, 2)
 assert.equal(h.calls[0].args.scope, 'aims.read aims:product-roadmaps:read')
 const body = { ...draft, definition: { ...draft.definition, visibility: 'product' } }
 await assert.rejects(harness({ body }).run(), { statusCode: 403 })
 const shared = harness({ body, admin: true }); await shared.run()
 assert.equal(shared.calls[0].args.body.authorization.action, 'edit')
})
test('saved view rejects mixed facts and preserves authorization or runtime failure', async () => {
 for (const [options, statusCode] of [[{ key: null }, 400], [{ query: { actor: 'other' } }, 400], [{ denied: true }, 403], [{ mixed: true }, 409], [{ wrongProduct: true }, 409], [{ unavailable: true }, 503], [{ error: true }, 409], [{ path: 'list', method: 'POST' }, 405]] as const) {
 const h = harness(options); await assert.rejects(h.run(), { statusCode })
 if (!('unavailable' in options) && !('error' in options)) assert.equal(h.calls.length, 0)
 }
})

test('saved view update/delete choose current edit facts and permissions remain explicit', async () => {
 for (const method of ['PATCH', 'DELETE']) {
  const body = { expectedRevision: 2, expectedViewRevision: 1, ...(method === 'PATCH' ? { definition: draft.definition } : {}) }
  const h = harness({ path: id, method, body, admin: true }); await h.run()
  assert.equal(h.calls[0].args.body.authorization.action, 'edit')
  assert.equal(h.calls[0].args.body.input.biz_id, id)
  assert.equal(h.calls[0].args.scope, 'aims.write aims:product-roadmaps:view-' + (method === 'PATCH' ? 'update' : 'delete'))
 }
 const permissions = harness({ path: 'permissions', method: 'GET' })
 assert.equal((await permissions.run()).data.edit, false)
 assert.equal(permissions.calls.length, 0)
})

test('roadmap route dispatches views without adding a parallel catch-all route', async () => {
 const routeCode = ts.transpileModule(readFileSync(new URL('../server/api/v1/products/[productCode]/roadmaps/[...roadmapPath].ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
 for (const path of ['adoption', 'cost', 'views/list', 'views/' + id + '/apply', 'quarter', 'release-diff', 'feature-version-matrix', 'execution-coordination', 'documents', 'documents/search', 'documents/template-create', 'documents/link-created', 'documents/request-status', 'documents/request-resume', 'documents/requests', 'documents/content', 'documents/create', 'documents/remove', 'documents/restore', 'documents/purpose']) {
  const exports: { default?: (event: object) => unknown } = {}
  const calls: string[] = []
  runInNewContext(routeCode, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
   if (name === 'h3') return { getRouterParam: () => path }
   if (name.endsWith('/productAdoptionRuntime')) return { handleProductAdoption: () => calls.push('adoption') }
   if (name.endsWith('/productCostRuntime')) return { handleProductCost: () => calls.push('cost') }
   if (name.endsWith('/productSavedViewRuntime')) return { handleProductSavedView: (_: unknown, suffix: string) => calls.push('views:' + suffix) }
   if (name.endsWith('/productDocumentRemoveRuntime')) return { handleProductDocumentRemove: () => calls.push('document-remove'), handleProductDocumentPurpose: () => calls.push('document-purpose'), handleProductDocumentRestore: () => calls.push('document-restore'), handleProductDocumentCreate: () => calls.push('document-create') }
   if (name.endsWith('/productDocumentRequestsRuntime')) return { handleProductDocumentRequests: () => calls.push('document-requests') }
   if (name.endsWith('/productDocumentRequestStatusRuntime')) return { handleProductDocumentRequestStatus: () => calls.push('document-request-status'), handleProductDocumentRequestResume: () => calls.push('document-request-resume') }
   if (name.endsWith('/productDocumentLinkCreatedRuntime')) return { handleProductDocumentLinkCreated: () => calls.push('document-link-created') }
   if (name.endsWith('/productDocumentTemplateRuntime')) return { handleProductDocumentTemplateCreate: () => calls.push('document-template-create') }
   if (name.endsWith('/productDocumentContentRuntime')) return { handleProductDocumentContent: () => calls.push('document-content') }
   if (name.endsWith('/productDocumentSearchRuntime')) return { handleProductDocumentSearch: () => calls.push('document-search') }
   if (name.endsWith('/productDocumentRuntime')) return { handleProductDocumentList: () => calls.push('documents') }
   if (name.endsWith('/productExecutionCoordinationRuntime')) return { handleProductExecutionCoordination: () => calls.push('coordination') }
   if (name.endsWith('/productFeatureVersionMatrixRuntime')) return { handleProductFeatureVersionMatrix: () => calls.push('matrix') }
   if (name.endsWith('/productReleaseDiffRuntime')) return { handleProductReleaseDiff: () => calls.push('diff') }
   if (name.endsWith('/productRoadmapRuntime')) return { handleProductRoadmap: () => calls.push('roadmap') }
   throw new Error(name)
  } })
  await exports.default!({})
  assert.deepEqual(calls, [path === 'adoption' || path === 'cost' ? path : path === 'documents' ? 'documents' : path.startsWith('documents/') ? 'document-' + path.slice(10) : path === 'execution-coordination' ? 'coordination' : path === 'feature-version-matrix' ? 'matrix' : path === 'release-diff' ? 'diff' : path.startsWith('views/') ? 'views:' + path.slice(6) : 'roadmap'])
 }
})
