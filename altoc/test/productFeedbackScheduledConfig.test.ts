import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../server/utils/scheduledRuntime.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function resolve(config: Record<string, unknown>, env: Record<string, string>) {
  const exports: Record<string, () => string> = {}
  runInNewContext(compiled, { exports, require: () => ({}), useRuntimeConfig: () => config, process: { env } })
  return exports.scheduledProductFeedbackTargetDeployment!()
}

test('scheduled feedback target is explicit and never falls back to source deployment', () => {
  const env = { HZY_TENANT_RUNTIME_DEPLOYMENT: 'ALTOC', HZY_PLATFORM_DEPLOYMENT_CODE: 'ALTOC' }
  assert.equal(resolve({ hzy: { tenantRuntime: { deployment: 'ALTOC' } } }, env), '')
  assert.equal(resolve({}, { ...env, HZY_ALTOC_PRODUCT_FEEDBACK_AIMS_DEPLOYMENT: ' AIMS ' }), 'AIMS')
  assert.equal(resolve({ hzy: { productFeedback: { aimsDeployment: 'AIMS-CONFIG' } } }, { HZY_ALTOC_PRODUCT_FEEDBACK_AIMS_DEPLOYMENT: 'AIMS-ENV' }), 'AIMS-CONFIG')
  const drain = readFileSync(new URL('../server/utils/integrationOperationDrain.ts', import.meta.url), 'utf8')
  assert.ok(drain.includes('createScheduledOpsKnowledgeOperationIO(callRuntime, scheduledProductFeedbackTargetDeployment())'))
})
