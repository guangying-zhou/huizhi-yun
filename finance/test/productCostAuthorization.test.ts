import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as actions from '../../foundation/shared/utils/authorizationActions.ts'

function load(name: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>> = {}
  const code = ts.transpileModule(readFileSync(new URL(`../server/utils/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, console, require: (key: string) => {
    if (key in dependencies) return dependencies[key]
    throw new Error(key)
  } })
  return exports
}

test('product cost uses original subject and preserves project grant intersections and unions', async () => {
  const core = load('financeScopedAuthorization', {
    '@hzy/foundation/server/utils/platformBundleAuthorization': {},
    '@hzy/foundation/server/utils/dataAccessScope': {},
    '@hzy/foundation/shared/utils/authorizationActions': actions,
    '~~/app/config/permissions': { appCode: 'finance' }
  })
  const project = (value: string) => ({ dimension: 'project', predicate: 'code', value })
  const permission = { appCode: 'finance', resourceCode: 'project_accounting', action: 'view' }
  for (const scenario of [{ action: 'view', granted: 'view', denied: false }, { action: 'view', granted: '', denied: true }, { action: 'edit', granted: 'edit', denied: false }, { action: 'edit', granted: 'view', denied: true }]) {
    const { action, denied } = scenario
    permission.action = scenario.granted
    const consumer = load('productCostAuthorization', {
      'h3': { createError }, './financeScopedAuthorization': core,
      '@hzy/foundation/server/utils/subjectScopedAuthorization': {
        loadSubjectScopedAuthorizationByService: async (input: Record<string, unknown>) => {
          assert.equal(input.subjectUid, 'U1')
          assert.equal(input.purpose, action === 'edit' ? 'product_cost_rules_edit' : 'product_cost_read')
          assert.equal(input.action, action)
          return { uid: 'U1', appCode: 'finance', authorizationMode: 'merged', grants: !scenario.granted
            ? []
            : [
                { permissions: [permission], defaultScopes: [project('P1'), project('P2')], assignmentScopes: [project('P2')] },
                { permissions: [permission], scopes: [project('P3')] }
              ] }
        }
      }
    })
    const resolve = action === 'edit' ? consumer.resolveProductCostRulesAuthorization! : consumer.resolveProductCostAuthorization!
    const result = resolve({ context: { consoleAuth: { uid: 'SERVICE' } } }, 'U1')
    if (denied) await assert.rejects(result, { statusCode: 403 })
    else {
      const query = await result
      assert.equal(query.current_user, 'U1')
      assert.equal(query.current_user_project_finance_access, 'projects')
      assert.equal(query.current_user_project_finance_project_codes, 'P2,P3')
    }
  }
})
