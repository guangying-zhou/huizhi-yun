import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productAssessmentInput'
import * as workspace from '../server/utils/productWorkspaceInput'

const id = '00000000-0000-4000-8000-000000000001'
const draft = { expectedRevision: 1, expectedCycleRevision: 1, expectedItemRevision: 1, expectedScopeRevision: 1, expectedEvidenceRevision: 1, assessment: { model_version: 'rice-v1', observation_biz_id: '', effort_unit: 'person_day', impact: null, confidence: null, effort_person_days: null }, rationale: {}, evidenceReferences: {}, evidence: [], estimateConfirmed: false }
const compiled = ts.transpileModule(readFileSync(new URL('../server/api/v1/products/[productCode]/planning-cycles/[cycleId]/items/[itemId]/rice-assessments.post.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { denied?: boolean, query?: Record<string, unknown>, body?: unknown, key?: string | null, unavailable?: boolean, error?: boolean } = {}) {
  type RuntimeArgs = { scope: string, query: { current_user: string }, idempotencyKey: string, body: { input: { cycle_biz_id: string, item_biz_id: string }, authorization: { action: string, expires_at: number } } }
  const calls: { path: string, args: RuntimeArgs }[] = [], permissions: string[] = [], exports = {} as { default: (event: object) => Promise<unknown> }
  runInNewContext(compiled, { exports, defineEventHandler: (handler: unknown) => handler, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: (_: unknown, key: string) => key === 'productCode' ? 'P-A' : id, getQuery: () => options.query ?? {}, getHeader: () => options.key === undefined ? 'rice-key' : options.key, readBody: async () => options.body ?? draft, setHeader: () => {} }
    if (name.endsWith('/productAssessmentInput')) return input
    if (name.endsWith('/productWorkspaceInput')) return workspace
    if (name.endsWith('/productAuthorization')) return { requireProductPermission: async (_: unknown, code: string, resource: string, action: string) => {
      permissions.push(resource + ':' + action)
      if (options.denied) throw createError({ statusCode: 403 })
      return { product_code: code, actor_uid: 'session-user', revision: 1 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_: unknown, path: string, args: unknown) => {
      calls.push({ path, args: args as RuntimeArgs })
      return { handled: !options.unavailable, data: { code: options.error ? 409 : 0, data: {} } }
    } }
    if (name.endsWith('/aimsRuntimeForward')) return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    throw new Error(name)
  } })
  return { calls, permissions, run: () => exports.default({}) }
}
test('RICE route binds assess permission, session actor, exact capability and idempotency', async () => {
  const h = harness()
  await h.run()
  assert.deepEqual(h.permissions, ['product_priorities:assess'])
  const { path, args } = h.calls[0]
  assert.equal(path, '/v1/aims/internal/products/P-A/planning-assessments:rice-create')
  assert.equal(args.scope, 'aims.write aims:product-priorities:rice-assess')
  assert.equal(args.query.current_user, 'session-user')
  assert.equal(args.idempotencyKey, 'rice-key')
  assert.equal(args.body.input.cycle_biz_id, id)
  assert.equal(args.body.input.item_biz_id, id)
  assert.equal(args.body.authorization.action, 'assess')
  assert.ok(args.body.authorization.expires_at > Date.now())
  assert.ok(args.body.authorization.expires_at <= Date.now() + 15000)
})
test('RICE route rejects overrides and preserves permission and service failures', async () => {
  for (const [options, statusCode] of [[{ key: null }, 400], [{ query: { actor: 'other' } }, 400], [{ body: { ...draft, actor: 'other' } }, 400], [{ denied: true }, 403], [{ unavailable: true }, 503], [{ error: true }, 409]] as const) {
    const h = harness(options)
    await assert.rejects(h.run(), { statusCode })
    if (!('unavailable' in options) && !('error' in options)) assert.equal(h.calls.length, 0)
  }
})
