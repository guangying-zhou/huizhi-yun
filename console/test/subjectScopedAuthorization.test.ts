import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { subjectDepartmentTreeIndex } from '../server/utils/subjectDepartmentTree.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/subjectScopedAuthorization.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('delegated scoped loading checks active subject and revision-checked merged authorization', async () => {
  for (const mode of ['valid', 'inactive', 'missing', 'directory-down', 'departments-down', 'bypass', 'wrong-user', 'wrong-app', 'simulation', 'policy-down', 'probe-down']) {
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
      if (name === './revisionCheckedServicePolicy') return { evaluateWithRevisionCheckedConsoleServicePolicy: async (_event: unknown, tenant: string, evaluate: () => Promise<unknown>) => {
        assert.equal(tenant, 'T')
        if (mode === 'probe-down') throw new Error('revision_probe_unavailable')
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
    assert.equal(policyCalls, ['inactive', 'missing', 'directory-down', 'departments-down', 'bypass', 'probe-down'].includes(mode) ? 0 : 1)
  }
})

test('Aims project document writes get authoritative directory tree, other Aims purposes do not', async () => {
  const exports: Record<string, (event: unknown, request: unknown) => Promise<Record<string, unknown>>> = {}
  let treeCalls = 0
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name === './subjectDepartmentTree') return { subjectDepartmentTreeIndex }
    if (name.endsWith('/consoleTenantRuntimeClient')) return {
      getConsoleDirectoryUser: async () => ({ data: { status: 'active' } }),
      getConsoleDirectoryUserDepartments: async () => ({ data: { departments: [] } }),
      getConsoleDirectoryDepartments: async () => {
        treeCalls++
        return { data: { flat: [{ deptCode: 'D1', parentId: null, orgType: 'department' }, { deptCode: 'D2', parentId: 'D1', orgType: 'department' }] } }
      }
    }
    if (name === './platformRuntime') return { loadConsoleRuntimeMode: () => ({ devPolicyBypassEnabled: false }) }
    if (name === './revisionCheckedServicePolicy') return { evaluateWithRevisionCheckedConsoleServicePolicy: async (_event: unknown, _tenant: string, evaluate: () => Promise<unknown>) => evaluate() }
    if (name === './policyScopedAuthorization') return { loadPolicyScopedAuthorization: async () => ({ uid: 'U', appCode: 'aims', authorizationMode: 'merged', grants: [], bundleVersion: 'v1', policyRevision: 1 }) }
    throw new Error(name)
  } })
  const base = { subjectUid: 'U', targetAppCode: 'aims', resourceCode: 'projects', tenantId: 'T', deploymentId: 'D' }
  const write = await exports.loadSubjectScopedAuthorization!({}, { ...base, action: 'edit', purpose: 'enterprise_project_document_write' })
  assert.equal(JSON.stringify(write.departmentTree.D1), JSON.stringify(['D1', 'D2']))
  assert.equal(treeCalls, 1)
  const read = await exports.loadSubjectScopedAuthorization!({}, { ...base, action: 'view', purpose: 'enterprise_project_document_read' })
  assert.equal(JSON.stringify(read.departmentTree), JSON.stringify({}))
  assert.equal(treeCalls, 1)
})
