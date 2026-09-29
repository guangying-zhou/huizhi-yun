import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateEnterpriseEntitlement, enterpriseModuleAvailability } from '../server/utils/enterpriseEntitlement.ts'
const now = Date.parse('2026-09-13T12:00:00Z')
const payload = () => ({ enterpriseEntitlement: { schemaVersion: 'enterprise-entitlement.v1', productCode:'enterprise-full',tenantCode:'T1',revision:1,status:'active',effectiveStatus:'active',effectiveFrom:'2026-09-01T00:00:00Z',end:{kind:'finite',effectiveUntil:'2026-10-01T00:00:00Z'} },moduleAvailability:[{appCode:'aims',deploymentState:'deployed',configurationState:'unknown'}] })
test('legacy is preserved; enterprise is tenant bound and time bounded', () => {
  assert.equal(evaluateEnterpriseEntitlement({},'T1',now).mode,'legacy')
  assert.equal(evaluateEnterpriseEntitlement(payload(),'T1',now).allowed,true)
  assert.equal(evaluateEnterpriseEntitlement(payload(),'T2',now).allowed,false)
  assert.equal(evaluateEnterpriseEntitlement(payload(),'T1',Date.parse('2026-10-01T00:00:00Z')).allowed,false)
  assert.equal(evaluateEnterpriseEntitlement(payload(),'T1',Date.parse('2026-08-01T00:00:00Z')).allowed,false)
})
test('suspension, revocation, malformed schema and time fail closed', () => {
  for (const status of ['pending','suspended','revoked','expired']) { const p=payload();p.enterpriseEntitlement.status=status;assert.equal(evaluateEnterpriseEntitlement(p,'T1',now).allowed,false) }
  for (const field of ['schemaVersion','effectiveFrom','productCode']) { const p=payload();p.enterpriseEntitlement[field as 'schemaVersion']='bad';assert.equal(evaluateEnterpriseEntitlement(p,'T1',now).allowed,false) }
  assert.equal(evaluateEnterpriseEntitlement({enterpriseEntitlement:null},'T1',now).allowed,false)
})
test('technical availability does not manufacture readiness or an upgrade gate', () => {
  assert.equal(enterpriseModuleAvailability(payload(),'aims')?.deploymentState,'deployed')
  assert.equal(enterpriseModuleAvailability(payload(),'assets')?.availabilityCode,'module_not_deployed')
  assert.equal(enterpriseModuleAvailability(payload(),'assets')?.availabilityReason,'未部署')
  const p=payload();p.moduleAvailability.push(p.moduleAvailability[0]!);assert.equal(enterpriseModuleAvailability(p,'aims')?.deploymentState,'not-deployed')
  const configured = payload(); configured.moduleAvailability[0]!.configurationState = 'not-configured'
  assert.equal(enterpriseModuleAvailability(configured,'aims')?.availabilityCode,'module_not_configured')
  assert.equal(enterpriseModuleAvailability({},'aims'),null)
})

test('effective tenant suspension overrides raw active status; unlimited requires evidence', () => {
  const p = payload(); p.enterpriseEntitlement.effectiveStatus = 'suspended'
  assert.equal(evaluateEnterpriseEntitlement(p,'T1',now).allowed,false)
  const unlimited = { ...payload(), enterpriseEntitlement: { ...payload().enterpriseEntitlement, end: {kind:'unlimited',evidenceReference:'conversion-42'} } }
  assert.equal(evaluateEnterpriseEntitlement(unlimited,'T1',now).allowed,true)
  unlimited.enterpriseEntitlement.end.evidenceReference=''
  assert.equal(evaluateEnterpriseEntitlement(unlimited,'T1',now).allowed,false)
})
