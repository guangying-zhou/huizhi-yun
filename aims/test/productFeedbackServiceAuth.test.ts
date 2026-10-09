/* eslint-disable @typescript-eslint/no-explicit-any -- VM substitutes verified auth and gateway providers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { requireServiceScope } from '../server/utils/serviceAuth'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackServiceAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
async function run(mode = '') {
  const exports: any = {}
  const auth = { authenticated: true, subjectType: 'service', tokenUse: 'service', appCode: 'altoc', clientCode: mode === 'client' ? 'other.runtime' : 'altoc.runtime', scopes: ['aims:product-request:create-from-feedback'], tenant: 'TENANT', deployment: 'ALTOC' }
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name === 'h3') return { createError }
    if (name === './serviceAuth') return { requireServiceScope }
    if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => auth }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'missing' ? null : { tenant: mode === 'tenant' ? 'OTHER' : 'TENANT', appCode: mode === 'target' ? 'codocs' : 'aims', deployment: 'AIMS' } }
    throw new Error(name)
  } })
  return exports.requireProductFeedbackServiceAuth({ context: { consoleAuth: auth } })
}
test('feedback service binds exact caller to trusted target deployment', async () => {
  const result = await run()
  assert.equal(result.sourceDeployment, 'ALTOC')
  assert.equal(result.targetDeployment, 'AIMS')
  for (const mode of ['client', 'missing', 'tenant', 'target']) await assert.rejects(run(mode), { statusCode: 403 })
})
