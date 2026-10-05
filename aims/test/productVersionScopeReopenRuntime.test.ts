import * as visibilityInput from '../server/utils/productVersionVisibilityInput'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as legacyInput from '../server/utils/productVersionLegacyCriteriaInput'
import * as input from '../server/utils/productVersionArchiveInput'
import * as versionInput from '../server/utils/productVersionInput'
import * as pageInput from '../server/utils/productRequestInput'
import * as workspace from '../server/utils/productWorkspaceInput'

interface RuntimeArgs { scope: string, idempotencyKey?: string, query: { current_user: string }, body: { input: { version_id: number, scope_id: number }, authorization: { facts: { actor_uid: string } } } }

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productVersionScopeRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, response?: unknown } = {}) {
  const calls: { path: string, args: RuntimeArgs }[] = []
  const permissions: string[] = []
  const headers: Record<string, string> = {}
  const exports: Record<string, (event: unknown, action: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: (_event: unknown, key: string) => (({ productCode: '产品 A', versionId: '12', scopeId: '7' } as Record<string, string | undefined>)[key]), getQuery: () => options.query || {}, readBody: async () => options.body || { expectedRevision: 1, expectedVersionRevision: 2, expectedScopeRevision: 3, reason: '重新核对验收范围' }, getHeader: () => options.key === undefined ? 'scope-reopen-key' : options.key, setHeader: (_event: unknown, key: string, value: string) => {
      headers[key] = value
    } }
    if (name === './productVersionLegacyCriteriaInput') return legacyInput
    if (name === './productVersionVisibilityInput') return visibilityInput
    if (name === './productVersionArchiveInput') return input
    if (name === './productRequestInput') return pageInput
    if (name === './productVersionInput') return versionInput
    if (['./productVersionScopeInput', './productVersionExecutionVisibility', './aimsScopedAuthorization', './productVersionReopenInput', './productVersionPublishInput', './productRequestInput', './productVersionAcceptanceInput'].includes(name)) return {}
    if (name === './productWorkspaceInput') return workspace
    if (name === './productAuthorization') return { requireProductPermission: async (_event: unknown, code: string, resource: string, action: string) => {
      permissions.push(`${code}:${resource}:${action}`)
      if (options.denied) throw createError({ statusCode: 403 })
      return { actor_uid: 'session-user', revision: 7 }
    } }
    if (name.endsWith('/tenantRuntimeClient')) return { maybeCallTenantRuntime: async (_event: unknown, path: string, args: RuntimeArgs) => {
      calls.push({ path, args })
      return options.response ?? { handled: true, data: { code: 0, data: { ok: true } } }
    } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: () => createError({ statusCode: 409 }) }
    throw new Error(`Unexpected dependency ${name}`)
  } })
  return { run: (action: string) => exports.handleProductVersionScope!({}, action), calls, permissions, headers }
}

test('scope reopening BFF binds trusted actor, product scope and idempotency without browser authority', async () => {
  const h = harness()
  await h.run('reopen')
  assert.deepEqual(h.permissions, ['产品 A:product_versions:accept'])
  const call = h.calls[0]!
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/versions:scope-reopen`)
  assert.equal(call.args.scope, 'aims.write aims:product-versions:scope-reopen')
  assert.equal(call.args.idempotencyKey, 'scope-reopen-key')
  assert.equal(call.args.query.current_user, 'session-user')
  assert.equal(call.args.body.authorization.facts.actor_uid, 'session-user')
  assert.equal(call.args.body.input.version_id, 12)
  assert.equal(call.args.body.input.scope_id, 7)
  assert.equal(h.headers['Cache-Control'], 'no-store')
})

test('invalid or unauthorized requests never reach runtime; unavailable runtime stays retryable', async () => {
  for (const options of [{ key: null }, { query: { actor: 'other' } }, { body: { expectedRevision: 1, body: 'text', author_uid: 'other' } }]) {
    const h = harness(options)
    await assert.rejects(h.run('reopen'), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
    assert.equal(h.permissions.length, 0)
  }
  const denied = harness({ denied: true })
  await assert.rejects(denied.run('reopen'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
  await assert.rejects(harness({ response: { handled: false } }).run('reopen'), { statusCode: 503 })
  await assert.rejects(harness({ response: { handled: true, data: { code: 1 } } }).run('reopen'), { statusCode: 409 })
})

test('scope history uses read authority and bounded pagination', async () => {
  const h = harness({ query: { page: '2', pageSize: '10' } })
  await h.run('history')
  assert.deepEqual(h.permissions, ['产品 A:product_versions:view'])
  assert.equal(h.calls[0]!.args.scope, 'aims.read aims:product-versions:read')
  assert.equal(h.calls[0]!.args.idempotencyKey, undefined)
  assert.equal(h.calls[0]!.path.endsWith('/versions:scope-history'), true)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0]!.args.body.input)), { page: 2, page_size: 10, version_id: 12, scope_id: 7 })
  for (const query of [{ keyword: 'private' }, { pageSize: '101' }, { page: '0' }]) {
    const bad = harness({ query })
    await assert.rejects(bad.run('history'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
})

test('legacy criteria only accepts criteria and revision fields with edit authority', async () => {
  const body = { expectedRevision: 1, expectedVersionRevision: 2, expectedScopeRevision: 3, reason: '历史补录', acceptanceCriteria: '明确验收标准' }
  const h = harness({ body })
  await h.run('legacy-criteria')
  assert.deepEqual(h.permissions, ['产品 A:product_versions:edit'])
  assert.equal(h.calls[0]!.args.scope, 'aims.write aims:product-versions:scope-legacy-criteria')
  for (const extra of [{ itemBizId: 'other' }, { legacy_unscored: true }, { status: 'delivered' }, { acceptanceCriteria: '' }, { acceptanceCriteria: 'a'.repeat(10001) }]) {
    const bad = harness({ body: { ...body, ...extra } })
    await assert.rejects(bad.run('legacy-criteria'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
})


test('scope visibility requires edit and preserves explicit false', async () => {
  const body = { expectedRevision: 1, expectedVersionRevision: 2, expectedScopeRevision: 3, reason: '内部范围', isPublic: false }
  const h = harness({ body })
  await h.run('visibility')
  assert.deepEqual(h.permissions, ['产品 A:product_versions:edit'])
  assert.equal(h.calls[0]!.args.scope, 'aims.write aims:product-versions:scope-visibility')
  assert.equal((h.calls[0]!.args.body.input as unknown as Record<string, unknown>).is_public, false)
  for (const invalid of [{ ...body, isPublic: 'false' }, { ...body, actorUid: 'other' }, { ...body, expectedScopeRevision: 0 }]) {
    const bad = harness({ body: invalid })
    await assert.rejects(bad.run('visibility'))
    assert.equal(bad.calls.length, 0)
  }
})
