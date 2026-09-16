import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productLightweightPlanInput.ts'
import * as workspace from '../server/utils/productWorkspaceInput.ts'

interface RuntimeCall {
  path: string
  args: {
    scope: string
    idempotencyKey?: string
    query: { current_user: string }
    body: Record<string, unknown>
  }
}

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productLightweightPlanRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const request = '00000000-0000-4000-8000-000000000001'
const revisions = { expectedRevision: 1, expectedVersionRevision: 2, expectedPlanRevision: 3, expectedScopeRevision: 4 }

function harness(options: { action?: string, body?: unknown, query?: Record<string, unknown>, key?: string | null, unavailable?: boolean, runtimeError?: boolean, responseData?: Record<string, unknown> } = {}) {
  const calls: RuntimeCall[] = []
  const permissions: string[] = []
  const exports: Record<string, (event: unknown, action: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return {
      createError,
      getRouterParam: (_: unknown, key: string) => ({ productCode: 'P-A', versionId: '9', scopeId: '7' } as Record<string, string>)[key],
      getQuery: () => options.query ?? {},
      getHeader: () => options.key === undefined ? 'plan-key' : options.key,
      readBody: async () => options.body,
      setHeader: () => {}
    }
    if (name === './productLightweightPlanInput') return input
    if (name === './productWorkspaceInput') return workspace
    if (name === './productAuthorization') return {
      requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
        permissions.push(`${code}:${resource}:${action}`)
        return { actor_uid: 'session-user', revision: 7 }
      },
      checkProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
        permissions.push(`${code}:${resource}:${action}`)
        return { allowed: action !== 'handoff' }
      }
    }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: RuntimeCall['args']) => {
      calls.push({ path, args })
      return options.unavailable
        ? { handled: false, data: { code: 0, data: {} } }
        : { handled: true, data: { code: options.runtimeError ? 1 : 0, data: options.responseData ?? { plan_status: 'draft', scope_revision: 4 } } }
    } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    throw new Error(`Unexpected dependency ${name}`)
  } })
  return { calls, permissions, run: (action = options.action ?? 'item-list') => exports.handleProductLightweightPlan!({}, action) }
}

test('plan item listing injects route version identity and binds both read permits', async () => {
  const h = harness({ query: { page: '2', pageSize: '10', keyword: '登录' } })
  await h.run('item-list')
  assert.deepEqual(h.permissions, ['P-A:product_versions:view', 'P-A:product_requests:view'])
  const call = h.calls[0]!
  assert.equal(call.path, '/v1/aims/internal/products/P-A/versions:plan-items')
  assert.equal(call.args.scope, 'aims.read aims:product-versions:read')
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.body.input)), { version_id: 9, page: 2, page_size: 10, keyword: '登录' })
})

test('scope adoption forwards independent view, decide, and planning permits', async () => {
  const body = { expectedRevision: 1, expectedVersionRevision: 2, expectedPlanRevision: 3, expectedRequestRevision: 4, requestBizId: request, scopeSummary: '登录与退出', estimatePersonDays: '1.25', acceptanceCriteria: '验收通过', sortOrder: 1, adoptRequest: true }
  const h = harness({ body })
  await h.run('item-create')
  assert.deepEqual(h.permissions, ['P-A:product_versions:edit', 'P-A:product_requests:view', 'P-A:product_requests:decide', 'P-A:product_priorities:edit'])
  const call = h.calls[0]!
  assert.equal(call.args.scope, 'aims.write aims:product-versions:edit')
  assert.equal(call.args.idempotencyKey, 'plan-key')
  assert.equal((call.args.body.request_authorization as { action: string }).action, 'view')
  assert.equal((call.args.body.request_decision_authorization as { action: string }).action, 'decide')
  assert.equal((call.args.body.planning_authorization as { action: string }).action, 'edit')
})

test('confirmation requires prioritize and preserves retryable/runtime conflict outcomes', async () => {
  const body = { ...revisions }
  const h = harness({ body })
  await h.run('confirm')
  assert.deepEqual(h.permissions, ['P-A:product_versions:edit', 'P-A:product_priorities:prioritize'])
  assert.equal((h.calls[0]!.args.body.planning_authorization as { action: string }).action, 'prioritize')
  await assert.rejects(harness({ body, unavailable: true }).run('confirm'), { statusCode: 503 })
  await assert.rejects(harness({ body, runtimeError: true }).run('confirm'), { statusCode: 409 })
})

test('plan read camel-cases Runtime data and exposes presentation-only permissions', async () => {
  const h = harness({ responseData: { plan_status: 'confirmed', scope_revision: 4, confirmation: { confirmed_by: 'pm' } } })
  const result = await h.run('read') as { data: Record<string, unknown> }
  assert.equal(result.data.planStatus, 'confirmed')
  assert.equal((result.data.confirmation as Record<string, unknown>).confirmedBy, 'pm')
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.permissions)), { canEditPlan: true, canCreateScope: true, canConfirmPlan: true, canDecideRequests: true, canHandoff: false })
})
