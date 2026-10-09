import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('ingress binds source and Enterprise target to the verified route deployments', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const exports = {
      '@hzy/foundation/server/utils/consoleOidc': 'export const requireConsoleAuthContext=async()=>globalThis.__p1Ingress.auth',
      '@hzy/foundation/server/utils/tenantGatewayTrust': 'export const resolveTrustedTenantGatewayContext=()=>globalThis.__p1Ingress.target',
      '@hzy/foundation/server/utils/serviceAppUrl': 'export const resolveTrustedServiceAppRoute=(_event,app)=>globalThis.__p1Ingress.routes[app]'
    }
    if (exports[specifier]) return { url: `data:text/javascript,${encodeURIComponent(exports[specifier])}`, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { requireEnterpriseAimsServiceIngress } = await import('../server/utils/enterpriseAimsServiceIngress.ts')
    for (const [family, app, scope] of [['callback', 'workflow', 'enterprise:workflow-callback:execute'], ['notification', 'console', 'enterprise:notification-detail:authorize']]) {
      const good = { auth: { subjectType: 'service', tokenUse: 'service', appCode: app, clientCode: `${app}.runtime`, tenant: 'T', deployment: `T-${app}`, scopes: [scope] }, target: { appCode: 'enterprise', tenant: 'T', deployment: 'T-enterprise' }, routes: { enterprise: { deploymentCode: 'T-enterprise' }, [app]: { deploymentCode: `T-${app}` } } }
      globalThis.__p1Ingress = good
      assert.equal(await requireEnterpriseAimsServiceIngress({}, family), good.auth)
      for (const bad of [{ ...good, target: { ...good.target, deployment: 'wrong' } }, { ...good, routes: { ...good.routes, enterprise: null } }, { ...good, auth: { ...good.auth, deployment: 'wrong' } }, { ...good, target: { ...good.target, tenant: 'other' } }]) {
        globalThis.__p1Ingress = bad
        await assert.rejects(requireEnterpriseAimsServiceIngress({}, family), { statusCode: 403 })
      }
    }
  } finally {
    hooks.deregister()
    delete globalThis.__p1Ingress
  }
})
