import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as core from '../server/utils/assetsScopedAuthorizationCore.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productAdoptionAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('adoption uses delegated departments and independently requires both resources', async () => {
  for (const denied of ['', 'deliveries', 'environments']) {
    const exports: Record<string, (event: unknown, actor: string, tree: unknown) => Promise<Record<string, Record<string, string>>>> = {}
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './assetsScopedAuthorizationCore') return core
      if (name.endsWith('/subjectScopedAuthorization')) return { loadSubjectScopedAuthorizationByService: async (input: { subjectUid: string, resourceCode: string, purpose: string }) => {
        assert.equal(input.subjectUid, 'U1')
        assert.equal(input.purpose, `product_adoption_${input.resourceCode}`)
        return { departmentCodes: ['D1'], departmentTree: { D1: ['D1'] }, grants: denied === input.resourceCode ? [] : [{ permissions: [{ appCode: 'assets', resourceCode: input.resourceCode, action: 'view' }], scopes: [{ dimension: 'department', predicate: 'self' }] }] }
      } }
      throw new Error(name)
    } })
    const promise = exports.resolveProductAdoptionAuthorization!({ context: { consoleAuth: { deptCodes: ['OTHER'] } } }, 'U1', {})
    if (denied) await assert.rejects(promise, { statusCode: 403 })
    else {
      const result = await promise
      for (const scope of [result.delivery!, result.environment!]) {
        assert.equal(scope.current_user, 'U1')
        assert.deepEqual(JSON.parse(scope.current_user_assets_scope_units!).map((unit: { departmentCodes: string[] }) => unit.departmentCodes), [['D1']])
      }
    }
  }
})
