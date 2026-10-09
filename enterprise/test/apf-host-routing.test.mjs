import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'
import { deriveBusinessApiSurface } from '../composition/business-api-surface.mjs'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'
import { renderEnterpriseHostRoutes } from '../../deploy/test-env/generate-enterprise-host-routes.mjs'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { ledgerApi } from '../../finance/app/utils/hostFinanceLedger.ts'

const concrete = pattern => pattern.replace(/:[A-Za-z0-9_]+/g, '1')

test('Host-owned APF APIs reach Gateway only for generated exact method/path pairs', () => {
  const derived = deriveBusinessApiSurface().routes.filter(row => row.route.startsWith('/enterprise/api/apf/'))
  assert.ok(derived.length > 20)
  assert.deepEqual(businessApiRoutes.filter(([, path]) => path.startsWith('/enterprise/api/apf/')),
    derived.map(({ method, route }) => [method, route]))
  for (const { method, route } of derived) {
    const path = concrete(route)
    assert.equal(resolveEnterprisePilotPath(path, '', method)?.kind, 'api', `${method} ${path}`)
    assert.equal(resolveEnterprisePilotPath(`${path}/unregistered/not-an-operation/extra`, '', method)?.kind, 'unavailable')
    assert.equal(resolveEnterprisePilotPath(path, '', 'TRACE')?.kind, 'unavailable')
  }
  for (const path of ['/enterprise/api/apf/unknown/list', '/enterprise/api/apf/people/ranks/', '/enterprise/api/apf/people//ranks', '/enterprise/api/apf/people/../ranks', '/enterprise/api/apf/people/%31/ranks']) {
    assert.equal(resolveEnterprisePilotPath(path, '', 'GET')?.kind, 'unavailable', path)
  }
  assert.equal(resolveEnterprisePilotPath('/enterprise/api/internal/apf/scheduler-inspect', '', 'POST')?.kind, 'unavailable')
})

test('Finance spending and Altoc tender pages cannot drift out of the generated Host topology', () => {
  assert.equal(readFileSync(new URL('../../deploy/test-env/enterprise-host-routes.mjs', import.meta.url), 'utf8'), renderEnterpriseHostRoutes())
  const pages = registerBusinessPages([], businessModules, 'placeholder.vue')
  for (const path of ['/finance/expenses', '/finance/expenses/claims', '/finance/expenses/project-requests', '/finance/payment-requests', '/altoc/tenders']) {
    // Altoc is registered as a Host native page rather than a layer page.
    if (path.startsWith('/finance/')) {
      const page = pages.find(page => page.path === path)
      assert.ok(page, path)
      assert.equal(page.meta.authorizationApp, 'finance')
      assert.match(readFileSync(page.file, 'utf8'), /import FinanceLedgerList/)
    }
    assert.equal(resolveEnterprisePilotPath(path)?.kind, 'page', path)
  }
})

test('Host Finance ledger uses registered BFF URLs without a duplicate finance segment', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '#imports') return { url: 'data:text/javascript,' + encodeURIComponent(`export const useRuntimeConfig=()=>({public:{appCode:'enterprise'}});export const useState=()=>({value:'session'});`), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { useFinanceModule } = await import('../../finance/layer/useFinanceModule.ts')
    const module = useFinanceModule()
    assert.equal(module.hosted, true)
    for (const kind of ['expenses', 'claims', 'project-requests', 'payment-requests', 'invoice-requests', 'receipts', 'reconciliation']) {
      const path = module.apiUrl(`/${ledgerApi(kind)}`)
      assert.equal(resolveEnterprisePilotPath(path, '', 'GET')?.kind, 'api', path)
      assert.ok(businessApiRoutes.some(([method, route]) => method === 'GET' && route === path), path)
      assert.ok(!path.includes('/api/v1/finance/'))
    }
    assert.equal(resolveEnterprisePilotPath('/finance/api/v1/finance/expenses')?.kind, 'unavailable', 'legacy standalone URL is deliberately not opened')
    const component = readFileSync(new URL('../../finance/app/components/host/FinanceLedgerList.vue', import.meta.url), 'utf8')
    assert.match(component, /<ContentPageHeader/)
    assert.match(component, /:title="projectOnly \? '项目支出台账' : ledgerTitles\[kind\]"/)
  } finally { hooks.deregister() }
})
