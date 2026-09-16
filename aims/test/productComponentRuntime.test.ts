import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productComponentInput'
import * as versionInput from '../server/utils/productVersionInput'
import * as workspace from '../server/utils/productWorkspaceInput'

interface RuntimeArgs { scope: string, idempotencyKey?: string, query: { current_user: string }, body: { input: Record<string, unknown>, authorization: { facts: { actor_uid: string } } } }

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productComponentRuntime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(options: { body?: unknown, query?: Record<string, unknown>, key?: string | null, denied?: boolean, response?: unknown } = {}) {
  const calls: { path: string, args: RuntimeArgs }[] = []
  const permissions: string[] = []
  const headers: Record<string, string> = {}
  const exports: Record<string, (event: unknown, action: string) => Promise<unknown>> = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError, getRouterParam: (_event: unknown, key: string) => (({ productCode: '产品 A', componentId: '12' } as Record<string, string | undefined>)[key]), getQuery: () => options.query || {}, readBody: async () => options.body || { expectedRevision: 1, expectedComponentRevision: 2, parentId: null, reason: '移动模块' }, getHeader: () => options.key === undefined ? 'component-key' : options.key, setHeader: (_event: unknown, key: string, value: string) => {
      headers[key] = value
    } }
    if (name === './productComponentInput') return input
    if (name === './productVersionInput') return versionInput
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
  return { run: (action: string) => exports.handleProductComponent!({}, action), calls, permissions, headers }
}

test('component move BFF binds trusted actor, product scope and idempotency without browser authority', async () => {
  const h = harness()
  await h.run('move')
  assert.deepEqual(h.permissions, ['产品 A:product_components:edit'])
  const call = h.calls[0]!
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/components:move`)
  assert.equal(call.args.scope, 'aims.write aims:product-components:move')
  assert.equal(call.args.idempotencyKey, 'component-key')
  assert.equal(call.args.query.current_user, 'session-user')
  assert.equal(call.args.body.authorization.facts.actor_uid, 'session-user')
  assert.equal(call.args.body.input.component_id, 12)
  assert.equal(h.headers['Cache-Control'], 'no-store')
})

test('invalid or unauthorized requests never reach runtime; unavailable runtime stays retryable', async () => {
  for (const options of [{ key: null }, { query: { actor: 'other' } }, { body: { expectedRevision: 1, body: 'text', author_uid: 'other' } }]) {
    const h = harness(options)
    await assert.rejects(h.run('move'), { statusCode: 400 })
    assert.equal(h.calls.length, 0)
    assert.equal(h.permissions.length, 0)
  }
  const denied = harness({ denied: true })
  await assert.rejects(denied.run('move'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
  await assert.rejects(harness({ response: { handled: false } }).run('move'), { statusCode: 503 })
  await assert.rejects(harness({ response: { handled: true, data: { code: 1 } } }).run('move'), { statusCode: 409 })
})


test('component list BFF forwards only the requested parent and pagination under view permission', async () => {
  const h = harness({ query: { parentId: '7', page: '2', pageSize: '10' }, key: null })
  await h.run('list')
  assert.deepEqual(h.permissions, ['产品 A:product_components:view'])
  const call = h.calls[0]!
  assert.equal(call.args.scope, 'aims.read aims:product-components:read')
  assert.equal(call.args.idempotencyKey, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.body.input)), { parent_id: 7, page: 2, page_size: 10 })
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/components:list`)
  const invalid = harness({ query: { page: '1', actor_uid: 'other' } })
  await assert.rejects(invalid.run('list'), { statusCode: 400 })
  assert.equal(invalid.calls.length, 0)
  const denied = harness({ denied: true })
  await assert.rejects(denied.run('list'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
})

test('component create BFF preserves explicit root and does not import the route component ID', async () => {
  const draft = { parentId: null, expectedRevision: 7, name: '认证', description: '身份与会话', sortOrder: 2 }
  const h = harness({ body: draft })
  await h.run('create')
  const call = h.calls[0]!
  assert.equal(call.path, `/v1/aims/internal/products/${encodeURIComponent('产品 A')}/components:create`)
  assert.equal(call.args.scope, 'aims.write aims:product-components:create')
  assert.equal(call.args.idempotencyKey, 'component-key')
  assert.deepEqual(h.permissions, ['产品 A:product_components:edit'])
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.body.input)), { parent_id: null, expected_revision: 7, name: '认证', description: '身份与会话', sort_order: 2 })
  for (const body of [{ ...draft, component_id: 123 }, { ...draft, authorization: { action: 'admin' } }]) {
    const invalid = harness({ body })
    await assert.rejects(invalid.run('create'), { statusCode: 400 })
    assert.equal(invalid.calls.length, 0)
  }
})

test('component edit binds route and revisions without changing hierarchy', async () => {
  const body = { name: '认证中心', description: '身份服务', sortOrder: 1, expectedRevision: 2, expectedComponentRevision: 1, reason: '明确职责' }
  const h = harness({ body })
  await h.run('edit')
  const call = h.calls[0]!
  assert.equal(call.args.scope, 'aims.write aims:product-components:edit')
  assert.equal(call.args.body.input.component_id, 12)
  assert.equal(call.args.body.input.expected_component_revision, 1)
  assert.equal(call.args.body.input.parent_id, undefined)
  for (const invalid of [{ ...body, parentId: null }, { ...body, sortOrder: 2147483648 }, { ...body, expectedComponentRevision: 0 }]) {
    const bad = harness({ body: invalid })
    await assert.rejects(bad.run('edit'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
})

test('component deletion uses independent delete permission and rejects client reference claims', async () => {
  const body = { expectedRevision: 2, expectedComponentRevision: 1, reason: '清理空模块' }
  const h = harness({ body })
  await h.run('delete')
  assert.deepEqual(h.permissions, ['产品 A:product_components:delete'])
  assert.equal(h.calls[0]!.args.scope, 'aims.write aims:product-components:delete')
  assert.equal(h.calls[0]!.args.body.input.component_id, 12)
  assert.equal(h.calls[0]!.args.idempotencyKey, 'component-key')
  for (const invalid of [{ ...body, cascade: true }, { ...body, childCount: 0 }, { ...body, componentId: 13 }, { ...body, reason: '' }]) {
    const bad = harness({ body: invalid })
    await assert.rejects(bad.run('delete'), { statusCode: 400 })
    assert.equal(bad.calls.length, 0)
  }
  const denied = harness({ body, denied: true })
  await assert.rejects(denied.run('delete'), { statusCode: 403 })
  assert.equal(denied.calls.length, 0)
})
