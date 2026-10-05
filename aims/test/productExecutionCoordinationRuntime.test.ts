import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as version from '../server/utils/productVersionInput'
import * as paging from '../server/utils/productModelInput'
import * as cross from '../server/utils/productCrossDependencyInput'
import * as visibility from '../server/utils/productExecutionCoordinationVisibility'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productExecutionCoordinationRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { method?: string, query?: Record<string, unknown>, denied?: boolean, wrongProduct?: boolean, unavailable?: boolean, runtimeError?: boolean, authorizationOutage?: boolean } = {}) {
 const calls: any[] = [], checks: string[] = [], headers: string[] = [], exports: any = {}
 const counts = { target_count: 1, incomplete_target_count: 1, open_defect_count: 0, total_weight: 2, completed_weight: 0, no_execution_plan: false }
 const data = { ...counts, product_code: 'P', version_id: 8, workspace_revision: 2, defect_coverage: 'linked-descendants-only', target_count: 3, incomplete_target_count: 3, total_weight: 6, projects: [1,2,3].map(project_id => ({ ...counts, project_id, secret: 'private' })) }
 runInNewContext(compiled, { exports, require: (name: string) => {
  if (name === 'h3') return { createError, getRouterParam: () => 'P', getQuery: () => options.query ?? { versionId: '8', page: '1', pageSize: '1' }, setHeader: (_: unknown, key: string, value: string) => headers.push(key + ':' + value) }
  if (name === './productVersionInput') return version
  if (name === './productModelInput') return paging
  if (name === './productCrossDependencyInput') return cross
  if (name === './productExecutionCoordinationVisibility') return visibility
  if (name === './productAuthorization') return { requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
   checks.push(code + ':' + resource + ':' + action)
   if (options.denied) throw createError({ statusCode: 403 })
   return { product_code: options.wrongProduct ? 'OTHER' : 'P', actor_uid: 'trusted-user', revision: 2 }
  } }
  if (name === './aimsScopedAuthorization') return {
   resolveAimsProjectAuthorizationObject: async (_: unknown, args: any) => { assert.equal(args.uid, 'trusted-user'); assert.equal(args.requireCompleteFacts, true); return { id: args.projectId } },
   checkAimsScopedPermission: async (_: unknown, args: any) => {
    checks.push(args.object.id + ':' + args.resourceCode + ':' + args.action)
    if (options.authorizationOutage) throw createError({ statusCode: 503 })
    return !(args.object.id === '2' && args.resourceCode === 'projects') && !(args.object.id === '3' && args.resourceCode === 'work_items')
   }
  }
  if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: any) => { calls.push({ path, args }); return { handled: !options.unavailable, data: { code: options.runtimeError ? 409 : 0, data } } } }
  if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
  throw new Error(name)
 } })
 return { calls, checks, headers, run: () => exports.handleProductExecutionCoordination({ method: options.method ?? 'GET' }) }
}
test('coordination BFF binds actor and requires project and work-item visibility', async () => {
 const h = harness(), result = await h.run()
 assert.deepEqual(h.headers, ['Cache-Control:no-store'])
 assert.deepEqual(h.checks, ['P:product_versions:view','1:projects:view','1:work_items:view','2:projects:view','3:projects:view','3:work_items:view'])
 assert.equal(h.calls[0].path, '/v1/aims/internal/products/P/versions:execution-coordination')
 assert.equal(h.calls[0].args.scope, 'aims.read aims:product-versions:read')
 assert.equal(h.calls[0].args.query.current_user, 'trusted-user')
 assert.equal(h.calls[0].args.body.input.version_id, 8)
 assert.equal(h.calls[0].args.body.authorization.resource, 'product_versions')
 assert.equal(h.calls[0].args.body.authorization.action, 'view')
 assert.ok(h.calls[0].args.body.authorization.expires_at > Date.now())
 assert.equal(result.data.total, 1)
 assert.equal(result.data.total_weight, 6)
 assert.equal(result.data.restricted_project_count, 2)
 assert.deepEqual(result.data.projects.map((p: any) => p.project_id), [1])
 assert.equal(JSON.stringify(result).includes('private'), false)
})
test('coordination BFF rejects overrides and preserves authorization outages', async () => {
 for (const [options, statusCode] of [[{method:'POST'},405],[{query:{versionId:'0'}},400],[{query:{versionId:'8',actor:'fake'}},400],[{query:{versionId:'8',pageSize:'101'}},400],[{denied:true},403],[{wrongProduct:true},409],[{unavailable:true},503],[{runtimeError:true},409],[{authorizationOutage:true},503]] as const) {
  const h = harness(options)
  await assert.rejects(h.run(), { statusCode })
  if (!('unavailable' in options) && !('runtimeError' in options) && !('authorizationOutage' in options)) assert.equal(h.calls.length, 0)
 }
})
