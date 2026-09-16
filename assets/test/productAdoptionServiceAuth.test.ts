import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { requireServiceScope } from '../server/utils/serviceAuth.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productAdoptionServiceAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('adoption service binds exact capability, source and trusted target', async () => {
  for (const mode of ['valid', 'wide', 'source', 'client', 'tenant', 'target', 'missing', 'user', 'expired', 'outage']) {
    const exports: Record<string, unknown> = {}
    const auth = { authenticated: !['expired', 'outage'].includes(mode), reason: mode === 'outage' ? 'service_token_introspection_unavailable' : 'invalid_token', tokenUse: 'service', subjectType: mode === 'user' ? 'user' : 'service', appCode: mode === 'source' ? 'altoc' : 'aims', clientCode: mode === 'client' ? 'other' : 'aims.runtime', tenant: 'TENANT', deployment: 'AIMS', scopes: [mode === 'wide' ? 'assets:read' : 'assets:product-adoption:read'] }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './serviceAuth') return { requireServiceScope }
      if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => auth }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'missing' ? null : { tenant: mode === 'tenant' ? 'OTHER' : 'TENANT', deployment: 'ASSETS', appCode: mode === 'target' ? 'aims' : 'assets' } }
      throw new Error(name)
    } })
    const handler = exports.requireProductAdoptionServiceAuth as (event: unknown) => Promise<Record<string, string>>
    const promise = handler({ context: { consoleAuth: auth } })
    if (mode === 'valid') {
      const result = await promise
      assert.equal(result.sourceDeployment, 'AIMS')
      assert.equal(result.targetDeployment, 'ASSETS')
    } else await assert.rejects(promise, { statusCode: mode === 'outage' ? 503 : ['user', 'expired'].includes(mode) ? 401 : 403 })
  }
})
