import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Foundation subject eligibility client derives app and runtime binding and uses one narrow capability', () => {
  const source = readFileSync(new URL('../server/utils/subjectEligibility.ts', import.meta.url), 'utf8')
  assert.match(source, /targetAppCode = text\(runtime\.app\.appCode\)/)
  assert.match(source, /tenantId = text\(runtime\.tenant\?\.tenantCode\)/)
  assert.match(source, /deploymentId = text\(runtime\.deployment\?\.deploymentCode\)/)
  assert.match(source, /audience: 'console'/)
  assert.doesNotMatch(source, /audience: 'console_authorization'/)
  assert.match(source, /scope: 'console:authorization:subject-eligibility'/)
  assert.match(source, /resolveTrustedTenantGatewayContext/)
  assert.match(source, /body: \{[\s\S]*subjectUid:[\s\S]*purpose:/)
  assert.doesNotMatch(source, /activeRoleCode|authorizationMode|objectScope|simulation|resourceCode:/)
  assert.match(source, /data\.allowed !== \(data\.active && data\.reason === 'allowed'\)/)
  assert.match(source, /data\.reason !== 'subject_inactive'/)
  assert.match(source, /data\.reason !== 'permission_denied'/)
})
