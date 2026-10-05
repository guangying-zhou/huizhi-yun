import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productRoadmapPermissions.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const facts = { product_code: 'P-A', actor_uid: 'pm', status: 'active', revision: 2, is_member: true, is_manager: false }
function harness(options: { denyView?: boolean, unavailable?: boolean, commitOnly?: boolean, changedAction?: string, changed?: Record<string, unknown> } = {}) {
  const calls: string[] = []
  const exports: { productRoadmapPermissions?: (event: unknown, code: string) => Promise<{ data: Record<string, unknown> }> } = {}
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name === './productAuthorization') return {
      requireProductPermission: async (_event: unknown, _code: string, resource: string, action: string) => { calls.push(`${resource}:${action}`); if (options.denyView) throw createError({ statusCode: 404 }); return facts },
      checkProductPermission: async (_event: unknown, _code: string, resource: string, action: string) => { calls.push(`${resource}:${action}`); if (options.unavailable) throw createError({ statusCode: 503 }); return { allowed: action === (options.commitOnly ? 'commit' : 'edit'), facts: action === (options.changedAction ?? 'edit') ? { ...facts, ...options.changed } : facts } }
    }
    throw new Error(name)
  } })
  return { run: () => exports.productRoadmapPermissions!({}, 'P-A'), calls }
}

test('roadmap permission snapshot keeps actions independent and hides actor', async () => {
  const h = harness(), result = await h.run()
  assert.equal(result.data.edit, true)
  assert.equal(result.data.actor_uid, undefined)
  assert.equal(result.data.revision, 2)
  assert.equal(h.calls.length, 3)
  assert.equal(result.data.commit, false)
  assert.ok(h.calls.every(call => call.startsWith('product_roadmaps:')))
})

test('roadmap permissions reject invisible, unavailable and mixed-version facts', async () => {
  const denied = harness({ denyView: true }); await assert.rejects(denied.run(), { statusCode: 404 }); assert.equal(denied.calls.length, 1)
  await assert.rejects(harness({ unavailable: true }).run(), { statusCode: 503 })
  for (const changed of [{ revision: 3 }, { actor_uid: 'other' }, { product_code: 'P-B' }, { status: 'archived' }, { is_member: false }, { is_manager: true }]) await assert.rejects(harness({ changed }).run(), { statusCode: 409 })
})

test('commit capability is independent of edit and uses matching facts', async () => {
 const result=await harness({commitOnly:true}).run()
 assert.equal(result.data.commit,true)
 assert.equal(result.data.edit,false)
 await assert.rejects(harness({changedAction:'commit',changed:{revision:3}}).run(),{statusCode:409})
})
