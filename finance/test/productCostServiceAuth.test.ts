import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'

const guardExports: Record<string, unknown> = {}
const guardCode = ts.transpileModule(readFileSync(new URL('../server/utils/serviceAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
runInNewContext(guardCode, { exports: guardExports, require: (name: string) => {
  if (name === 'h3') return { createError }
  if (name.endsWith('/consoleOidc')) return {}
  throw new Error(name)
} })

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productCostServiceAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('product cost service binds exact capability, source and trusted target', async () => {
  for (const mode of ['valid', 'wide', 'source', 'client', 'tenant', 'target', 'missing', 'user', 'expired', 'outage', 'write-valid', 'write-read-token', 'rules-read-valid', 'rules-read-cost-token']) {
    const exports: Record<string, unknown> = {}
    const auth = { authenticated: !['expired', 'outage'].includes(mode), reason: mode === 'outage' ? 'service_token_introspection_unavailable' : 'invalid_token', tokenUse: 'service', subjectType: mode === 'user' ? 'user' : 'service', appCode: mode === 'source' ? 'altoc' : 'aims', clientCode: mode === 'client' ? 'other' : 'aims.runtime', tenant: 'TENANT', deployment: 'AIMS', scopes: [mode === 'wide' ? 'finance:read' : mode === 'rules-read-valid' ? 'finance:product-cost:read-rules' : mode === 'write-valid' ? 'finance:product-cost:replace-rules' : 'finance:product-cost:read'] }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './serviceAuth') return guardExports
      if (name.endsWith('/consoleOidc')) return { resolveConsoleAuthContext: async () => auth }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'missing' ? null : { tenant: mode === 'tenant' ? 'OTHER' : 'TENANT', deployment: 'FINANCE', appCode: mode === 'target' ? 'aims' : 'finance' } }
      throw new Error(name)
    } })
    const handler = (mode.startsWith('rules-read-') ? exports.requireProductCostRulesReadServiceAuth : mode.startsWith('write-') ? exports.requireProductCostRulesServiceAuth : exports.requireProductCostServiceAuth) as (event: unknown) => Promise<Record<string, string>>
    const promise = handler({ context: { consoleAuth: auth } })
    if (mode === 'valid' || mode === 'write-valid' || mode === 'rules-read-valid') {
      const result = await promise
      assert.equal(result.sourceDeployment, 'AIMS')
      assert.equal(result.targetDeployment, 'FINANCE')
    } else await assert.rejects(promise, { statusCode: mode === 'outage' ? 503 : ['user', 'expired'].includes(mode) ? 401 : 403 })
  }
})
