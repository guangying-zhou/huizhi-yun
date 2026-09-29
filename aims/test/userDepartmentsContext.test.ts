import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('Aims directory reads preserve the verified browser request context', () => {
  const source = readFileSync(new URL('../server/utils/userDepartments.ts', import.meta.url), 'utf8')

  assert.match(source, /fetchUserDepartments\(event: H3Event, uid: string\)/)
  assert.match(source, /'\/departments',[\s\S]*?\{ event, timeout: 10000 \}/)
  assert.match(source, /'\/user-departments',[\s\S]*?\{ event, params: \{ uid \} \}/)
  assert.doesNotMatch(source, /getDirectoryAuthHeaders\(\)/)
})

test('department service facts preserve managed descendants and do not turn denial into inferred membership', async () => {
  const source = readFileSync(new URL('../server/utils/userDepartments.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const denied of [false, true]) {
    const exports: Record<string, Function> = {}
    const event = { context: {} }
    const calls: string[] = []
    const child = { deptCode: 'child', name: 'Child', children: [] }
    const parent = { deptCode: 'managed', name: 'Managed', managerId: 'user', children: [child] }
    const own = { deptCode: 'own', name: 'Own', children: [] }
    runInNewContext(code, { exports, require: () => ({
      fetchDirectoryApi: () => { throw new Error('legacy API must not be used') },
      fetchConsoleDirectoryApi: async (path: string, options: { event: unknown, params?: { uid: string } }) => {
        assert.equal(options.event, event)
        calls.push(path)
        if (path === '/departments') return { code: 0, data: { tree: [parent, own], flat: [parent, child, own] } }
        assert.equal(path, '/user-departments')
        assert.equal(options.params?.uid, 'user')
        if (denied) throw Object.assign(new Error('denied'), { statusCode: 403 })
        return { code: 0, data: { primaryDeptCode: 'own', departments: [own] } }
      }
    }) })
    const pending = exports.fetchUserDepartments!(event, 'user')
    if (denied) await assert.rejects(pending, { statusCode: 403 })
    else {
      const result = JSON.parse(JSON.stringify(await pending))
      assert.equal(result.primaryDeptCode, 'own')
      assert.deepEqual(result.managedDeptCodes, ['managed', 'child'])
      assert.deepEqual(result.departments.map((node: { deptCode: string }) => node.deptCode), ['managed', 'own'])
    }
    assert.deepEqual(calls, ['/departments', '/user-departments'])
  }
})
