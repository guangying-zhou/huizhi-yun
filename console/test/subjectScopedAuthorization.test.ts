import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { subjectDepartmentTreeIndex } from '../server/utils/subjectDepartmentTree.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/subjectScopedAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('delegated scoped loading checks active subject and forces fresh merged authorization', async () => {
  for (const mode of ['valid', 'inactive', 'missing', 'directory-down', 'departments-down', 'bypass', 'wrong-user', 'wrong-app', 'simulation', 'policy-down']) {
    const exports: Record<string, (event: unknown, request: unknown) => Promise<Record<string, unknown>>> = {}
    let policyCalls = 0
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './subjectDepartmentTree') return { subjectDepartmentTreeIndex }
      if (name.endsWith('/consoleTenantRuntimeClient')) return { getConsoleDirectoryDepartments: async () => ({ data: { flat: [{ deptCode: 'D1', parentId: null, orgType: 'department' }] } }), getConsoleDirectoryUserDepartments: async (_event: unknown, uid: string) => {
        assert.equal(uid, 'original-user')
        if (mode === 'departments-down') throw new Error('directory unavailable')
        return { data: { departments: [{ deptCode: 'D1', orgType: 'department', relationType: 'member' }, { deptCode: 'D1', orgType: 'department', relationType: 'member' }, { deptCode: 'COM1', orgType: 'committee', relationType: 'member' }, { deptCode: 'D2', orgType: 'department', relationType: 'observer' }] } }
      }, getConsoleDirectoryUser: async (_event: unknown, uid: string, includeInactive: boolean) => {
        assert.equal(uid, 'original-user')
        assert.equal(includeInactive, true)
        if (['missing', 'directory-down'].includes(mode)) throw createError({ statusCode: mode === 'missing' ? 404 : 503 })
        return { data: { status: mode === 'inactive' ? 'inactive' : 'active' } }
      } }
      if (name === './platformRuntime') return { loadConsoleRuntimeMode: () => ({ devPolicyBypassEnabled: mode === 'bypass' }) }
      if (name === './notificationDetailFreshPolicy') return { evaluateWithFreshNotificationDetailPolicy: async (_event: unknown, binding: { tenantId: string }, evaluate: () => Promise<unknown>) => {
        assert.equal(binding.tenantId, 'T')
        return evaluate()
      } }
      if (name === './policyScopedAuthorization') return { loadPolicyScopedAuthorization: async (uid: string, app: string, _event: unknown, options: Record<string, unknown>) => {
        policyCalls++
        assert.equal(uid, 'original-user')
        assert.equal(app, 'assets')
        assert.equal(options.resourceCode, 'deliveries')
        assert.equal(options.action, 'view')
        assert.equal(options.authorizationMode, 'merged')
        for (const key of ['allowRoleSimulation', 'allowUserSimulation', 'allowPrivileged']) assert.equal(options[key], false)
        for (const key of ['ignoreSimulationSession', 'bypassSnapshotCache']) assert.equal(options[key], true)
        if (mode === 'policy-down') throw new Error('unavailable')
        return { uid: mode === 'wrong-user' ? 'other' : uid, appCode: mode === 'wrong-app' ? 'aims' : app, authorizationMode: mode === 'simulation' ? 'role_simulation' : 'merged', grants: [], roles: ['not-returned'] }
      } }
      throw new Error(name)
    } })
    const promise = exports.loadSubjectScopedAuthorization!({}, { subjectUid: 'original-user', targetAppCode: 'assets', resourceCode: 'deliveries', action: 'view', purpose: 'product_adoption_deliveries', tenantId: 'T', deploymentId: 'D' })
    if (mode === 'valid') {
      const result = await promise
      assert.equal(result.uid, 'original-user')
      assert.equal(result.roles, undefined)
      assert.equal(JSON.stringify(result.departmentCodes), JSON.stringify(['D1']))
    } else await assert.rejects(promise, { statusCode: ['inactive', 'missing'].includes(mode) ? 403 : 503 })
    assert.equal(policyCalls, ['inactive', 'missing', 'directory-down', 'departments-down', 'bypass'].includes(mode) ? 0 : 1)
  }
})
