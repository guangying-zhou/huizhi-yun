import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { requireAltocServiceAuth } from '../server/utils/serviceAuthGuard.ts'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/productFeedbackStatusAuth.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('status source requires exact service scope and distinct trusted deployment identities', async () => {
  for (const mode of ['valid', 'wide', 'client', 'tenant', 'target', 'missing', 'user']) {
    const exports: Record<string, (event: unknown) => Promise<Record<string, string>>> = {}
    const auth = { authenticated: true, tokenUse: 'service', subjectType: mode === 'user' ? 'user' : 'service', appCode: 'aims', clientCode: mode === 'client' ? 'other' : 'aims.runtime', tenant: 'TENANT', deployment: 'AIMS', scopes: [mode === 'wide' ? 'altoc:*' : 'altoc:product-feedback:update-status'] }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'h3') return { createError }
      if (name === './serviceAuthGuard') return { requireAltocServiceAuth }
      if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => auth }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => mode === 'missing' ? null : { tenant: mode === 'tenant' ? 'OTHER' : 'TENANT', deployment: 'ALTOC', appCode: mode === 'target' ? 'aims' : 'altoc' } }
      throw new Error(name)
    } })
    const promise = exports.requireProductFeedbackStatusAuth!({})
    if (mode === 'valid') {
      const result = await promise
      assert.equal(result.sourceDeployment, 'AIMS')
      assert.equal(result.targetDeployment, 'ALTOC')
    } else await assert.rejects(promise, { statusCode: mode === 'user' ? 401 : 403 })
  }
})
