import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enterpriseHostRoutesMatch, applyEnterpriseHostModuleRoutes } from '../server/utils/enterpriseModuleRoutes.ts'
import { enterpriseModuleAvailability } from '../server/utils/enterpriseEntitlementBundle.ts'

test('Host routes preserve logical namespaces and change route facts without creating deployment grants', () => {
  const route = { appCode: 'aims', hostAppCode: 'enterprise' as const, deploymentId: 4, deploymentCode: 'host', manifestHash: 'h', moduleManifestHash: 'm', basePath: '/aims/', apiBase: '/aims/api/v1', homeUrl: 'https://fixture.invalid/aims/' }
  const apps = [{ appCode: 'aims' }, { appCode: 'assets' }]
  const mapped = applyEnterpriseHostModuleRoutes(apps, [route])
  assert.equal(mapped[0]?.appCode, 'aims')
  assert.equal('homeUrl' in mapped[0]! && mapped[0].homeUrl, route.homeUrl)
  assert.deepEqual(mapped[1], apps[1])
  assert.deepEqual(enterpriseModuleAvailability(apps, [], [route]).map(item => item.deploymentState), ['deployed', 'not-deployed'])
  assert.equal(enterpriseHostRoutesMatch({}, [route]), false)
  assert.equal(enterpriseHostRoutesMatch({ enterpriseHostRoutes: [route] }, [route]), true)
  assert.equal(enterpriseHostRoutesMatch({ enterpriseHostRoutes: [route] }, []), false)
})
