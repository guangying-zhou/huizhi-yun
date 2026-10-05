import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productVersionArchiveInput'
import * as versionInput from '../server/utils/productVersionInput'
import * as workspace from '../server/utils/productWorkspaceInput'

interface RuntimeArgs { scope: string, idempotencyKey?: string, query: { current_user: string }, body: { input: { version_id: number }, authorization: { facts: { actor_uid: string } } } }

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productVersionAcceptanceRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, response?: unknown } = {}) {
  const calls: { path: string, args: RuntimeArgs }[] = []
  const permissions: string[] = []
  const headers: Record<string, string> = {}
  const exports: Record<string, (event: unknown, action: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: (_event: unknown, key: string) => (({ productCode: '产品 A', versionId: '12' } as Record<string, string | undefined>)[key]), getQuery: () => options.query || {}, readBody: async () => options.body || { expectedRevision: 1, expectedVersionRevision: 2, expectedScopeRevision: 3, reason: '删除空草稿' }, getHeader: () => options.key === undefined ? 'delete-key' : options.key, setHeader: (_event: unknown, key: string, value: string) => {
      headers[key] = value
    } }
    if (name === './productVersionArchiveInput') return input
    if (name === './productVersionInput') return versionInput
    if (['./productVersionExecutionVisibility', './aimsScopedAuthorization', './productVersionReopenInput', './productVersionPublishInput', './productRequestInput', './productVersionAcceptanceInput'].includes(name)) return {}
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
  return { run: (action: string) => exports.handleProductVersionAcceptance!({}, action), calls, permissions, headers }
}

test('version deletion BFF binds trusted actor, product scope and idempotency without browser authority', async () => {
  const h = harness()
  await h.run('delete')
  assert.deepEqual(h.permissions, ['产品 A:product_versions:delete'])
  const call = h.calls[0]!
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/versions:delete`)
  assert.equal(call.args.scope, 'aims.write aims:product-versions:delete')
  assert.equal(call.args.idempotencyKey, 'delete-key')
  assert.equal(call.args.query.current_user, 'session-user')
  assert.equal(call.args.body.authorization.facts.actor_uid, 'session-user')
  assert.equal(call.args.body.input.version_id, 12)
  assert.equal(h.headers['Cache-Control'], 'no-store')
})

test('invalid or unauthorized requests never reach runtime; unavailable runtime stays retryable', async () => {
  for (const options of [{ key: null }, { query: { actor: 'other' } }, { body: { expectedRevision: 1, body: 'text', author_uid: 'other' } }]) {
    const h = harness(options)
    await assert.rejects(h.run('delete'), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
    assert.equal(h.permissions.length, 0)
  }
  const denied = harness({ denied: true })
  await assert.rejects(denied.run('delete'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
  await assert.rejects(harness({ response: { handled: false } }).run('delete'), { statusCode: 503 })
  await assert.rejects(harness({ response: { handled: true, data: { code: 1 } } }).run('delete'), { statusCode: 409 })
})
