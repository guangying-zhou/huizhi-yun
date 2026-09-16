import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function handlerBlock(content: string) {
  const marker = 'export default defineEventHandler(async (event) => {'
  const index = content.indexOf(marker)
  assert.ok(index >= 0, 'route should export a defineEventHandler handler')
  return content.slice(index)
}

describe('legacy company organization compatibility write APIs', () => {
  const mutatingRoutes = [
    'server/api/v1/companies/index.post.ts',
    'server/api/v1/companies/[companyCode]/index.patch.ts',
    'server/api/v1/companies/[companyCode]/business-domains/index.post.ts',
    'server/api/v1/companies/[companyCode]/business-domains/[domainCode].patch.ts',
    'server/api/v1/companies/[companyCode]/business-domains/[domainCode].delete.ts',
    'server/api/v1/companies/[companyCode]/regions/index.post.ts',
    'server/api/v1/companies/[companyCode]/regions/[regionCode]/index.patch.ts',
    'server/api/v1/companies/[companyCode]/regions/[regionCode]/index.delete.ts',
    'server/api/v1/companies/[companyCode]/regions/[regionCode]/divisions.put.ts'
  ]

  for (const route of mutatingRoutes) {
    test(`${route} requires system settings edit before reading body or mutating org data`, () => {
      const content = handlerBlock(source(route))
      assert.match(content, /requireSystemSettingsAccess\(event,\s*'edit'\)/)

      const permissionIndex = content.indexOf('requireSystemSettingsAccess(event, \'edit\')')
      assert.ok(permissionIndex >= 0, `${route} must require system settings edit`)

      const sensitiveMarkers = [
        'await readBody',
        'await createCompany',
        'await updateCompany',
        'await createCompanyBusinessDomains',
        'await updateCompanyBusinessDomain',
        'await deleteCompanyBusinessDomain',
        'await createRegion',
        'await updateRegion',
        'await deleteRegion',
        'await initRegionsFromStandardTemplate',
        'await replaceRegionDivisions'
      ]
      const firstSensitiveIndex = sensitiveMarkers
        .map(marker => content.indexOf(marker))
        .filter(index => index >= 0)
        .sort((left, right) => left - right)[0]

      assert.equal(typeof firstSensitiveIndex, 'number', `${route} should contain a mutating operation`)
      assert.ok(permissionIndex < firstSensitiveIndex, `${route} must authorize before reading body or mutating org data`)
    })
  }
})
