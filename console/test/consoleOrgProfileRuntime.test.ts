import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const endpointPath = new URL('../server/api/v1/console/profile.get.ts', import.meta.url)
const updateEndpointPath = new URL('../server/api/v1/console/profile.put.ts', import.meta.url)
const pagePath = new URL('../app/pages/org-profile.vue', import.meta.url)
const clientPath = new URL('../../foundation/server/utils/consoleTenantRuntimeClient.ts', import.meta.url)
const legacyCompatPath = new URL('../server/utils/companyRuntimeCompat.ts', import.meta.url)
const bootstrapPath = new URL('../server/plugins/bootstrap.ts', import.meta.url)

describe('Console org-profile tenant-runtime migration', () => {
  test('BFF uses the Foundation runtime client and checks the local permission first', async () => {
    const source = await readFile(endpointPath, 'utf8')
    assert.match(source, /requirePermission\(event, 'org_profile', 'view'\)/)
    assert.match(source, /getConsoleTenantProfile\(event\)/)
    assert.doesNotMatch(source, /queryRow|queryRows|execute|withTransaction|server\/utils\/db/)
  })

  test('Foundation client freezes the runtime path and exact capability', async () => {
    const source = await readFile(clientPath, 'utf8')
    assert.match(source, /'\/v1\/console\/profile'/)
    assert.match(source, /scope: 'console:org-profile:view'/)
    assert.match(source, /scope: 'console:org-profile:edit'/)
    assert.match(source, /method: 'PUT'/)
    assert.match(source, /appCode: 'console'/)
    assert.match(source, /Console tenant-runtime is required for tenant data access/)
  })

  test('update BFF requires edit permission and an idempotency key', async () => {
    const source = await readFile(updateEndpointPath, 'utf8')
    assert.match(source, /requirePermission\(event, 'org_profile', 'edit'\)/)
    assert.match(source, /getHeader\(event, 'idempotency-key'\)/)
    assert.match(source, /updateConsoleTenantProfile\(event/)
    assert.doesNotMatch(source, /queryRow|queryRows|execute|withTransaction|server\/utils\/db/)
  })

  test('org-profile page consumes the migrated Console BFF instead of legacy company APIs', async () => {
    const source = await readFile(pagePath, 'utf8')
    assert.match(source, /useFetch<ApiResponse<OrgProfile>>/)
    assert.match(source, /'\/api\/v1\/console\/profile'/)
    assert.doesNotMatch(source, /\/api\/v1\/companies/)
    assert.doesNotMatch(source, /待接入 org-profile API/)
    assert.match(source, /expectedRevision: current\.revision/)
    assert.match(source, /method: 'PUT'/)
    assert.match(source, /hasPermission\('org_profile', 'edit'\)/)
  })

  test('legacy company compatibility maps to Tenant Runtime without DB access', async () => {
    const source = await readFile(legacyCompatPath, 'utf8')
    assert.match(source, /getConsoleTenantProfile\(event\)/)
    assert.match(source, /updateConsoleTenantProfile\(event, update\)/)
    assert.doesNotMatch(source, /orgCompat|queryRow|queryRows|execute|withTransaction|server\/utils\/db/)
  })

  test('startup no longer pulls a Platform profile and writes org_profiles directly', async () => {
    const source = await readFile(bootstrapPath, 'utf8')
    assert.doesNotMatch(source, /fetchPlatformTenantProfile|upsertOrgProfileFromPlatformTenant|hasOrgProfile/)
    assert.doesNotMatch(source, /server\/utils\/orgProfile|org_profiles/)
  })
})
