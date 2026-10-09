import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { webcrypto } from 'node:crypto'
import ts from 'typescript'
import { createError } from 'h3'
import { parseProductCostRulesResponse } from '../server/utils/productCostRulesResponse.ts'
import { crossDependencyProductCode } from '../server/utils/productCrossDependencyInput.ts'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/productCostRulesFinance.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
test('AIMS rules read checks project edit before obtaining exact Finance service token', async () => {
  for (const mode of ['valid', 'denied', 'route', 'wrong-result']) {
    const exports: Record<string, (event: unknown, product: string, project: string, period: string) => Promise<unknown>> = {}
    const calls: string[] = []
    const context = { exports, crypto: webcrypto, URL, $fetch: async (url: string, options: { headers: Record<string, string>, body: { serviceCommand: { command: { actorUid: string } } } }) => {
      calls.push('fetch')
      assert.equal(url, 'https://finance.test/api/v1/finance/service/product-cost/read-rules')
      assert.equal(options.headers['x-hzy-deployment'], 'FINANCE')
      assert.equal(options.headers['x-hzy-app-code'], 'finance')
      assert.equal(options.headers['x-forwarded-prefix'], '/finance')
      assert.equal(options.body.serviceCommand.command.actorUid, 'U1')
      return { code: 0, data: { projectCode: mode === 'wrong-result' ? 'OTHER' : 'PRJ1', periodMonth: '2026-09', revision: 1, evidenceRef: 'review', shares: [{ productCode: 'P1', basisPoints: 5000 }, { productCode: 'P2', basisPoints: 3000 }] } }
    }, require: (name: string) => {
      if (name.endsWith('/appServiceBinding')) return { serviceAppFetch: (_event: unknown, app: string, url: string, options: { headers: Record<string, string>, body: { serviceCommand: { command: { actorUid: string } } } }) => {
        assert.equal(app, 'finance')
        return context.$fetch(url, options)
      } }
      if (name === 'h3') return { createError, getHeader: () => '' }
      if (name === './productCostRulesResponse') return { parseProductCostRulesResponse }
      if (name === './productCrossDependencyInput') return { crossDependencyProductCode }
      if (name === './productCostRulesAuthorization') return { requireProductCostRulesProjectPermission: async (_event: unknown, projectId: string, projectCode: string) => {
        calls.push('permission')
        assert.equal(projectId, '1')
        assert.equal(projectCode, 'PRJ1')
        if (mode === 'denied') throw createError({ statusCode: 403 })
        return { projectId, projectCode, actorUid: 'U1' }
      } }
      if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: 'T', deployment: 'AIMS', appCode: 'aims' }) }
      if (name.endsWith('/serviceAppUrl')) return { resolveTrustedServiceAppRoute: () => mode === 'route' ? null : { baseUrl: 'https://finance.test', deploymentCode: 'FINANCE' } }
      if (name.endsWith('/serviceOidc')) return { requestServiceAccessToken: async (input: { audience: string, scope: string }) => {
        calls.push('token')
        assert.equal(input.audience, 'finance')
        assert.equal(input.scope, 'finance:product-cost:read-rules')
        return 'token'
      }, trustedServiceRequestHeaders: () => ({ 'x-hzy-deployment': 'FINANCE', 'x-hzy-app-code': 'finance', 'x-forwarded-prefix': '/finance' }) }
      if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload: async () => 'hash', buildServiceCommandRuntimeHeaders: async (input: { sourceDeploymentCode: string, targetDeploymentCode: string }) => {
        calls.push('sign')
        assert.equal(input.sourceDeploymentCode, 'AIMS')
        assert.equal(input.targetDeploymentCode, 'FINANCE')
        return {}
      } }
      throw new Error(name)
    } }
    runInNewContext(compiled, context)
    const promise = exports.readProductCostRulesFromFinance!({}, '1', 'PRJ1', '2026-09')
    if (mode === 'valid') await promise
    else await assert.rejects(promise, { statusCode: mode === 'denied' ? 403 : 503 })
    assert.deepEqual(calls, ['denied', 'route'].includes(mode) ? ['permission'] : ['permission', 'token', 'sign', 'fetch'])
  }
})
