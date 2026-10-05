import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productObjectivePermissions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const facts = { product_code: 'P-A', actor_uid: 'pm', status: 'active', revision: 2, is_member: true, is_manager: false }
function harness(options: { denyView?: boolean, unavailable?: boolean, changed?: Record<string, unknown> } = {}) {
  const calls: string[] = []
  const exports: { productObjectivePermissions?: (event: unknown, code: string) => Promise<{ data: Record<string, unknown> }> } = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name === './productAuthorization') return {
      requireProductPermission: async (_event: unknown, _code: string, resource: string, action: string) => { calls.push(`${resource}:${action}`); if (options.denyView) throw createError({ statusCode: 404 }); return facts },
      checkProductPermission: async (_event: unknown, _code: string, resource: string, action: string) => { calls.push(`${resource}:${action}`); if (options.unavailable) throw createError({ statusCode: 503 }); return { allowed: action === 'observe', facts: action === 'archive' ? { ...facts, ...options.changed } : facts } }
    }
    throw new Error(name)
  } })
  return { run: () => exports.productObjectivePermissions!({}, 'P-A'), calls }
}

test('objective permission snapshot keeps actions independent and hides actor', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.data.observe, true)
  for (const action of ['edit', 'activate', 'close', 'reopen', 'archive']) assert.equal(result.data[action], false)
  assert.equal(result.data.actor_uid, undefined)
  assert.equal(result.data.revision, 2)
  assert.equal(h.calls.length, 7)
  assert.ok(h.calls.every(call => call.startsWith('product_objectives:')))
})

test('objective permissions reject invisible, unavailable and mixed-version facts', async () => {
  const denied = harness({ denyView: true }); await assert.rejects(denied.run(), { statusCode: 404 }); assert.equal(denied.calls.length, 1)
  await assert.rejects(harness({ unavailable: true }).run(), { statusCode: 503 })
  for (const changed of [{ revision: 3 }, { actor_uid: 'other' }, { product_code: 'P-B' }, { status: 'archived' }, { is_member: false }, { is_manager: true }]) await assert.rejects(harness({ changed }).run(), { statusCode: 409 })
})
