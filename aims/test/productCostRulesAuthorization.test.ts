import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('cost rules require complete matching project facts and scoped project edit', async () => {
  for (const mode of ['allowed', 'denied', 'wrong-project', 'directory-outage']) {
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
    const calls: string[] = []
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './authIdentity') return { requireAimsSessionUid: async () => 'original-user' }
      if (name === './userDepartments') return { fetchUserDepartments: async () => {
        if (mode === 'directory-outage') throw createError({ statusCode: 503 })
        return { primaryDeptCode: 'D1', departments: [{ deptCode: 'D2', children: [{ deptCode: 'D3' }] }], managedDeptCodes: ['D4'] }
      } }
      if (name === './aimsScopedAuthorization') return { resolveAimsProjectAuthorizationObject: async (_event: unknown, options: Record<string, unknown>) => {
        calls.push('facts')
        assert.equal(options.requireCompleteFacts, true)
        assert.equal(options.uid, 'original-user')
        assert.equal(JSON.stringify(options.currentDeptCodes), '["D1","D2","D3"]')
        return { actorUid: 'original-user', projectId: 1, projectCode: mode === 'wrong-project' ? 'OTHER' : 'PRJ' }
      } }
      if (name.endsWith('/platformBundleAuthorization')) return { loadScopedAuthorizationFromConsoleRuntime: async (_event: unknown, uid: string, app: string, options: Record<string, unknown>) => {
        calls.push('authorize')
        assert.equal(uid, 'original-user')
        assert.equal(app, 'aims')
        assert.equal(options.resourceCode, 'projects')
        assert.equal(options.action, 'edit')
        return { decision: { allowed: mode !== 'denied' } }
      } }
      throw new Error(name)
    } })
    const pending = exports.requireProductCostRulesProjectPermission!({}, '1', 'PRJ')
    if (mode === 'allowed') {
      const permit = await pending as Record<string, unknown>
      assert.equal(permit.actorUid, 'original-user')
      assert.equal(permit.projectCode, 'PRJ')
    } else {
      await assert.rejects(pending, { statusCode: mode === 'denied' ? 403 : 503 })
    }
    if (mode === 'wrong-project' || mode === 'directory-outage') assert.equal(calls.includes('authorize'), false)
    await assert.rejects(exports.requireProductCostRulesProjectPermission!({}, '0', 'PRJ'), { statusCode: 400 })
  }
})
