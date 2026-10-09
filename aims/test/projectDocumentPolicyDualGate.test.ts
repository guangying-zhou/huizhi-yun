import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

test('project manager cannot change policy when Codocs edit ACL denies', async () => {
  const source = readFileSync(new URL('../server/utils/projectDocumentAccessPolicy.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let allow = false
  let policyWrites = 0
  let summaryWrites = 0
  const exports: Record<string, (...args: unknown[]) => Promise<{ code: number }>> = {}
  runInNewContext(code, { exports, require(name: string) {
    if (name === 'h3') return { createError }
    if (name === './codocsApi') return {
      checkCodocsDocumentAccess: async () => ({ allowed: allow }),
      updateCodocsDocumentAccessPolicy: async () => {
        policyWrites++
        return { lifecycleStage: 'formal', confidentialityLevel: 'L1', allowInternalAccess: true, allowCrossProject: false, grants: [] }
      }
    }
    if (name === './aimsProjectRuntimeAccess') return { buildAimsProjectListRuntimeAccessQuery: async () => ({}) }
    if (name === './projectDocumentAccess') return {
      getProjectDocumentContext: async () => ({ isManager: true, documentUuid: 'document-1', documentRefType: 'codocs_document', projectCode: 'P1', actorProjectCodes: ['P1'], actorDeptCodes: [], actorRoles: [] }),
      buildAccessSummary: () => 'summary',
      callAimsRuntime: async () => { summaryWrites++ }
    }
    throw new Error(name)
  } })
  const input = { lifecycleStage: 'formal', confidentialityLevel: 'L1', defaultPermission: 'view', allowInternalAccess: true, allowCrossProject: false, grants: [] }
  await assert.rejects(exports.updateProjectDocumentAccessPolicy!({}, 'actor', 1, 2, input), { statusCode: 403 })
  assert.equal(policyWrites, 0)
  assert.equal(summaryWrites, 0)
  allow = true
  const result = await exports.updateProjectDocumentAccessPolicy!({}, 'actor', 1, 2, input)
  assert.equal(result.code, 0)
  assert.equal(policyWrites, 1)
  assert.equal(summaryWrites, 1)
})
