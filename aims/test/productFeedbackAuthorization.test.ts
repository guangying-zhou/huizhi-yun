/* eslint-disable @typescript-eslint/no-explicit-any -- VM substitutes Console transport while retaining Foundation evaluation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as evaluator from '../../foundation/server/utils/scopeEvaluator'
import * as core from '../server/utils/productAuthorizationCore'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function run(mode = '') {
  const exports: any = {}, calls: any[] = []
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name.endsWith('/scopeEvaluator')) return evaluator
    if (name === './productAuthorizationCore') return core
    if (name.endsWith('/subjectScopedAuthorization')) return { loadSubjectScopedAuthorizationByService: async (input: any) => {
      const uid = input.subjectUid, app = 'aims', options = input
      assert.equal(input.purpose, 'product_feedback_create')
      calls.push({ uid, app, options })
      return { uid: mode === 'wrong-subject' ? 'another-user' : mode === 'missing-subject' ? undefined : uid, appCode: mode === 'wrong-app' ? 'assets' : app, grants: [{ grantId: 'product-manager', permissions: [{ appCode: 'aims', resourceCode: 'product_requests', action: mode === 'view-only' ? 'view' : 'create' }], scopes: [{ dimension: 'product', predicate: 'manager', value: 'P' }] }] }
    } }
    throw new Error(name)
  } })
  const facts = { product_code: mode === 'foreign' ? 'OTHER' : 'P', actor_uid: 'original-user', status: mode === 'archived' ? 'archived' : 'active', revision: 1, is_member: mode !== 'revoked', is_manager: mode !== 'revoked' }
  return { calls, result: await exports.requireProductFeedbackAuthorization({}, 'original-user', 'P', facts) }
}
test('feedback authorization evaluates original actor with current product scope', async () => {
  const { calls, result } = await run()
  assert.equal(calls[0].uid, 'original-user')
  assert.equal(result.action, 'create')
  assert.equal(result.facts.actor_uid, 'original-user')
})
test('feedback authorization rejects mismatched facts, wrong action, revoked membership and archived product', async () => {
  for (const [mode, statusCode] of [['foreign', 503], ['view-only', 403], ['revoked', 403], ['archived', 409], ['wrong-subject', 503], ['missing-subject', 503], ['wrong-app', 503]] as const) await assert.rejects(run(mode), { statusCode })
})
